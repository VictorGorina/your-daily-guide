import { asPromptData } from "@/lib/prompt-data";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COACH_MODEL,
  coachSystemPrompt,
  createAiProvider,
  PLAN_MODEL,
  requireAiKey,
} from "@/lib/ai-provider.server";
import { assertCleanFood } from "@/lib/assert-clean-food";
import { BLOCKED_FOOD_MESSAGE, VAGUE_DISH_MESSAGE } from "@/lib/content-guard";
import { requestDeadline } from "@/lib/deadline";
import {
  EMPTY_SCHEDULE,
  MEAL_KEYS as HOUSEHOLD_MEAL_KEYS,
  type MealKey,
} from "@/lib/household-shared";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  childPureeGaps,
  cleanPantryExtras,
  cleanPlan,
  cleanShopping,
  ingredientNames,
  isPinned,
  MEAL_SLOT_LABEL,
  MEAL_SLOTS,
  mealsForDate,
  type MealSlot,
  type MonthlyPlan,
  normName,
  type PantryExtra,
  parseJsonLoose,
  planForDate,
  planSlotIndex,
  type ShoppingList,
  weekdayName,
  withChildMeal,
  withPlanMeal,
} from "@/lib/plan-shared";
import { ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { askForJson } from "./ai.server";
import { guardSharedSlotWrite, ownPlanRow } from "./rows.server";

/**
 * Corrige la ortografía de un plato escrito a mano y calcula, en la MISMA
 * llamada al modelo, qué ingredientes necesita que no están en la compra. Un
 * plato a mano se guarda tal cual en el plan y se ve así para siempre (sin
 * corrección posterior) en Hoy, el calendario y la compra — de ahí que haga
 * falta corregirlo aquí: `setPlanMeal`/`setChildMeal` no pasan por el coach
 * (que ya cuida su propia ortografía, ver "Ortografía siempre correcta..." en
 * `coachSystemPrompt`), así que sin esto un cambio directo desde "Comí
 * distinto" se quedaba con las erratas tal cual las escribió la persona.
 *
 * El emparejamiento de ingredientes se resuelve con el modelo porque casar
 * texto libre con la lista no funciona a ojo ("pechuga de pollo" está
 * cubierto por "pollo", "tomates cherry" por "tomate"). Si la llamada falla,
 * el plato se guarda tal cual lo escribió la persona y sin avisos: preferimos
 * no corregir ni avisar antes que corregir mal o avisar en falso.
 *
 * No tiene cuota horaria propia (el cambio de plato no debe fallar por ella),
 * pero sí cuenta contra el tope de gasto: al llegar a él, el middleware del
 * modelo lanza, cae en el `catch` y el plato se guarda igual, sin corregir.
 */
async function resolveDish(
  userId: string,
  dish: string,
  shopping: ShoppingList,
  pantryExtras: PantryExtra[] = [],
  /**
   * ¿Se rechaza un texto vago ("algo rápido")? Sí en un cambio pedido por la
   * persona; no al deshacer (se restaura el plato del plan) ni cuando apunta
   * las kcal a mano, que es justo la salida que se le ofrece (ticket 13).
   */
  rejectVague = false,
): Promise<{ dish: string; off: string[] }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { dish, off: [] };

  const bought = ingredientNames(shopping);
  const extra = pantryExtras.map((e) => asPromptData(e.name)).join(", ");
  const names = [bought, extra].filter(Boolean).join(", ");

  try {
    const ai = createAiProvider(key, userId);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      temperature: 0,
      prompt:
        `Plato: "${dish}"\n\n` +
        "Corrige solo la ortografía de ese nombre de plato (acentos/tildes, mayúscula inicial, " +
        "erratas), sin cambiar el plato en sí ni añadir nada. Si ya está bien escrito, devuélvelo " +
        "igual.\n" +
        "Dime también si eso es comida de verdad: cualquier plato, alimento o bebida vale, por " +
        "raro, casero o poco saludable que sea. Solo NO es comida si es una broma, un insulto o " +
        "algo que no se come.\n" +
        'Y si es vago: true SOLO si el texto no permite saber qué se comió ("algo rápido", ' +
        '"lo de siempre", "lo que había en la oficina", "cualquier cosa"). Un plato genérico pero ' +
        'reconocible ("un bocadillo", "ensalada", "pasta") NO es vago.\n' +
        (names
          ? `Ingredientes disponibles (comprados y los que dice tener en casa): ${names}\n` +
            "Además, ¿qué ingredientes necesarios para ese plato NO están disponibles? " +
            "Da por disponibles la sal, el aceite, el vinagre, el agua y las especias básicas. " +
            "Cuenta como cubierto todo ingrediente equivalente aunque el nombre no sea idéntico " +
            "(p. ej. 'pechuga de pollo' lo cubre 'pollo'; 'tomate cherry' lo cubre 'tomate').\n"
          : "") +
        `Devuelve solo JSON: {"comida": true|false, "vago": true|false, "plato": "nombre del plato con la ortografía corregida"${
          names
            ? ', "fuera": [ingredientes que faltan, en minúsculas, máx. 5; lista vacía si no falta ninguno]'
            : ""
        }}`,
    });
    const parsed = (parseJsonLoose(text) ?? {}) as {
      plato?: unknown;
      fuera?: unknown;
      comida?: unknown;
      vago?: unknown;
    };
    // Segunda red, después de `assertCleanFood`: la lista corta lo evidente sin
    // gastar nada, y esto coge lo que una lista nunca cogerá (otros idiomas,
    // eufemismos, "un plato de heces"). Solo con un `false` explícito: si el
    // campo no llega, se deja pasar, como todo lo demás de esta función.
    if (parsed.comida === false) throw new ValidationError(BLOCKED_FOOD_MESSAGE);
    // Texto que no dice qué se comió: no se guarda un plato que luego no se
    // puede calcular, se le pide a la persona que concrete (D13). Igual que con
    // "comida", solo con un `true` explícito.
    if (rejectVague && parsed.vago === true) throw new ValidationError(VAGUE_DISH_MESSAGE);
    const corrected = typeof parsed.plato === "string" ? parsed.plato.trim() : "";
    const off = (Array.isArray(parsed.fuera) ? parsed.fuera : [])
      .map((n) => String(n).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
    return { dish: corrected && corrected.length <= 200 ? corrected : dish, off };
  } catch (error) {
    // "Esto no es comida" es una decisión, no un fallo del modelo: tiene que
    // salir fuera en vez de caer en el respaldo de "guárdalo tal cual".
    if (error instanceof ValidationError) throw error;
    console.error("resolveDish", error);
    return { dish, off: [] };
  }
}

/**
 * Cambia UN plato de UN día (hoy o futuro), sin pasar por la IA de planificación:
 * lo que pide la persona se escribe tal cual en el plan. Complementa a
 * `adjustMonthlyPlan`, que recoloca varios días para compensar; aquí el cambio
 * es literal y verificable, que es lo que se espera al pedir "cámbiame el
 * desayuno de mañana". Los días pasados no se tocan (ya están cerrados) y la
 * lista de la compra tampoco: si el plato pide algo que no se compró, se guarda
 * igualmente pero queda marcado para avisar en el chat y en pantalla.
 */
export const setPlanMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      date: string;
      slot: string;
      dish: string;
      today?: string;
      pin?: boolean;
      /** La persona apunta las kcal a mano: se acepta un texto vago (ticket 13). */
      manual?: boolean;
    }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? ""))
        throw new ValidationError("Fecha no válida");
      if (!MEAL_SLOTS.includes(input?.slot as MealSlot))
        throw new ValidationError("Comida no válida");
      const dish = String(input?.dish ?? "")
        .trim()
        .slice(0, 200);
      if (!dish) throw new ValidationError("Falta el plato nuevo");
      // Frontera de verdad: cubre a la vez la web, la app móvil (vía
      // `/api/v1/plan/meal`) y la herramienta `cambiar_plato` del coach.
      assertCleanFood(dish);
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
      if (input.date < today) {
        throw new ValidationError(
          "Los días pasados ya están cerrados: solo puedo cambiar de hoy en adelante",
        );
      }
      // Un plato pedido a mano queda fijado por defecto; `pin: false` solo lo
      // manda "Deshacer", para devolver el día al estado exacto de antes.
      const pin = input?.pin !== false;
      return {
        date: input.date,
        slot: input.slot as MealSlot,
        dish,
        today,
        pin,
        manual: input?.manual === true,
      };
    },
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      plan: MonthlyPlan;
      label: string;
      dish: string;
      off: string[];
      previousIdea: string;
      /** ¿Esa comida ya estaba elegida a mano antes del cambio? Para "Deshacer". */
      previousPinned: boolean;
    }> => {
      await guardSharedSlotWrite(context.supabase, context.userId, data.date, data.slot);

      const month = data.date.slice(0, 7);
      const { data: row } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        month,
        "plan, shopping, pantry_extras",
      );

      const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
      if (!current) throw new ValidationError(`Todavía no hay plan del mes ${month}`);
      const at = planSlotIndex(current, data.date);
      if (!at) throw new ValidationError("Ese día todavía no tiene menú en el plan");

      const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
      const pantryExtras = cleanPantryExtras(
        (row as { pantry_extras?: unknown } | null)?.pantry_extras,
      );
      const { dish, off } = await resolveDish(
        context.userId,
        data.dish,
        shopping,
        pantryExtras,
        data.pin && !data.manual,
      );

      // Se escribe sobre la versión más reciente de la fila (ticket 21):
      // `resolveDish` tarda y entretanto una recolocación puede haber escrito.
      // Lo de "antes" sale de esa misma versión, que es la que se sobrescribe.
      let next = current;
      let previousIdea = "";
      let previousPinned = false;
      try {
        await updatePlanRowCas(context.supabase as never, context.userId, month, "plan", (r) => {
          const latest = cleanPlan(r.plan);
          const cell = latest && planSlotIndex(latest, data.date);
          const written =
            latest && withPlanMeal(latest, data.date, data.slot, dish, { off, pin: data.pin });
          if (!latest || !cell || !written) {
            throw new ValidationError("Ese día todavía no tiene menú en el plan");
          }
          // Plato resuelto tal cual se veía en pantalla antes de este cambio
          // (con la rotación semanal ya aplicada para desayuno/snack si no había
          // un plato pedido a mano ese día), para que el caller pueda guardarlo
          // como "lo que había antes" — ver `wasIdea` en daily.ts.
          previousIdea =
            mealsForDate(latest, data.date).find((m) => m.slot === data.slot)?.idea ?? "";
          previousPinned = isPinned(latest.weeks[cell.weekIndex]?.days[cell.dayIndex], data.slot);
          next = written;
          return { plan: written };
        });
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        console.error("setPlanMeal", error);
        throw new Error("No hemos podido guardar el cambio de plato");
      }

      const { syncSharedMeals } = await import("@/lib/household.server");
      await syncSharedMeals({
        supabase: context.supabase as never,
        userId: context.userId,
        month,
        today: data.today,
      });

      return {
        plan: next,
        label: MEAL_SLOT_LABEL[data.slot],
        dish,
        off,
        previousIdea,
        previousPinned,
      };
    },
  );

/**
 * Pone (o quita) el plato aparte de un niño para un día concreto — paralela a
 * `setPlanMeal`, pero sobre `PlanDay.kids`. El plato aparte es parte del plan
 * compartido de la casa, así que solo lo cambia el planificador (D2): un no
 * planificador recibe un aviso y no se toca nada. `childId` puede venir como el
 * id real del niño o como su nombre (lo usa el coach). `dish` vacío quita el
 * override y el niño vuelve a comer el plato compartido. Los días pasados no se
 * tocan y la lista de la compra tampoco: si el plato pide algo no comprado, se
 * guarda igual y queda en `kids[].off` para avisar.
 */
export const setChildMeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { date: string; slot: string; childId: string; dish: string; today?: string }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? ""))
        throw new ValidationError("Fecha no válida");
      // Solo las 3 comidas principales: el snack nunca es compartido ni lleva
      // plato aparte de un niño (D5), así que no se espejaría a nadie.
      if (!HOUSEHOLD_MEAL_KEYS.includes(input?.slot as MealKey))
        throw new ValidationError("Comida no válida");
      const childId = String(input?.childId ?? "").trim();
      if (!childId) throw new ValidationError("Falta el niño");
      const dish = String(input?.dish ?? "")
        .trim()
        .slice(0, 200);
      // Vacío es legítimo aquí (quita el plato aparte y el niño vuelve a lo
      // compartido); lo que no vale es que tenga contenido y sea una broma.
      if (dish) assertCleanFood(dish);
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
      if (input.date < today) {
        throw new ValidationError(
          "Los días pasados ya están cerrados: solo puedo cambiar de hoy en adelante",
        );
      }
      return { date: input.date, slot: input.slot as MealSlot, childId, dish, today };
    },
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      plan: MonthlyPlan;
      childName: string;
      label: string;
      dish: string;
      off: string[];
    }> => {
      const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
      const home = await householdContext(context.supabase as never, context.userId);
      const child =
        home.children.find((c) => c.id === data.childId) ??
        home.children.find((c) => normName(c.name) === normName(data.childId));
      if (!child) throw new ValidationError("Ese niño no está en tu casa");
      // El plato aparte de un niño va con la comida compartida: lo fija el
      // planificador, igual que el resto de días compartidos (D2).
      if (home.plannerId && home.plannerId !== context.userId) {
        const plannerName =
          home.members.find((m) => m.userId === home.plannerId)?.displayName ??
          "quien lleva la cocina";
        throw new ValidationError(`El plato de ${child.name} lo pone ${plannerName} de tu casa.`);
      }

      const month = data.date.slice(0, 7);
      const { data: row } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        month,
        "plan, shopping, pantry_extras",
      );
      const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
      if (!current) throw new ValidationError(`Todavía no hay plan del mes ${month}`);
      const at = planSlotIndex(current, data.date);
      if (!at) throw new ValidationError("Ese día todavía no tiene menú en el plan");

      const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
      const pantryExtras = cleanPantryExtras(
        (row as { pantry_extras?: unknown } | null)?.pantry_extras,
      );
      const { dish, off } = data.dish
        ? await resolveDish(context.userId, data.dish, shopping, pantryExtras)
        : { dish: "", off: [] as string[] };

      // Sobre la versión más reciente de la fila (ticket 21): `resolveDish`
      // tarda y entretanto otra escritura puede haber llegado.
      const meal = { childId: child.id, slot: data.slot, dish, off };
      let next = current;
      try {
        await updatePlanRowCas(context.supabase as never, context.userId, month, "plan", (r) => {
          const latest = cleanPlan(r.plan);
          const written = latest && withChildMeal(latest, data.date, meal);
          if (!written) throw new ValidationError("Ese día todavía no tiene menú en el plan");
          next = written;
          return written === latest ? null : { plan: written };
        });
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        console.error("setChildMeal", error);
        throw new Error("No hemos podido guardar el plato del niño");
      }

      await syncSharedMeals({
        supabase: context.supabase as never,
        userId: context.userId,
        month,
        today: data.today,
      });

      return {
        plan: next,
        childName: child.name,
        label: MEAL_SLOT_LABEL[data.slot],
        dish,
        off,
      };
    },
  );

/**
 * Rellena los platos de los bebés de triturados que faltan en el plan del mes
 * en curso — pasa cuando se da de alta o se cambia de etapa a un bebé DESPUÉS
 * de que `generateMonthlyPlan` ya generó el mes, porque solo esa IA rellena
 * `days[].kids`. Detecta los huecos con `childPureeGaps` (comida/cena, de hoy
 * en adelante) y le pide a la IA SOLO el plato de cada hueco, a partir del
 * plato de la mesa de ese día. Incluso con la IA de por medio, el contrato es
 * el mismo que `setChildMeal`: nunca toca `lunch`/`dinner`/`breakfast` de los
 * adultos ni la lista de la compra — un ingrediente que falte se guarda igual
 * y queda en `kids[].off` para avisar.
 */
export const fillChildMeals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: { today?: string }) => ({
    today: /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input!.today! : zonedTodayISO(),
  }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ plan: MonthlyPlan; filled: number; children: string[] }> => {
      const deadline = requestDeadline();
      const key = requireAiKey();

      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(context.userId, "child-meals");

      const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
      const home = await householdContext(context.supabase as never, context.userId);

      // El plato de un peque va con la comida compartida: lo pone el
      // planificador (D2), igual que `setChildMeal`.
      if (home.plannerId && home.plannerId !== context.userId) {
        const plannerName =
          home.members.find((m) => m.userId === home.plannerId)?.displayName ??
          "quien lleva la cocina";
        throw new ValidationError(`Los platos de los peques los pone ${plannerName} de tu casa.`);
      }

      const month = data.today.slice(0, 7);
      const { data: row } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        month,
        "plan, shopping, pantry_extras",
      );
      const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
      if (!current) throw new ValidationError(`Todavía no hay plan del mes ${month}`);

      const pending = home.children
        .map((child) => ({
          child,
          gaps: childPureeGaps(
            current,
            {
              id: child.id,
              stage: child.stage,
              homeSchedule: child.homeSchedule ?? EMPTY_SCHEDULE,
            },
            data.today,
          ),
        }))
        .filter((p) => p.gaps.length > 0);

      if (!pending.length) return { plan: current, filled: 0, children: [] };

      const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
      const pantryExtras = cleanPantryExtras(
        (row as { pantry_extras?: unknown } | null)?.pantry_extras,
      );
      const available = [
        ingredientNames(shopping),
        pantryExtras.map((e) => asPromptData(e.name)).join(", "),
      ]
        .filter(Boolean)
        .join(", ");

      const { data: profile } = await context.supabase
        .from("profiles")
        .select("*")
        .eq("id", context.userId)
        .maybeSingle();

      const items = pending.flatMap(({ child, gaps }) =>
        gaps.map((g) => ({
          childId: child.id,
          name: child.name,
          age: child.age,
          allergies: child.allergies,
          date: g.date,
          slot: g.slot,
          adultDish:
            (g.slot === "comida"
              ? planForDate(current, g.date)?.day?.lunch
              : planForDate(current, g.date)?.day?.dinner) || "",
        })),
      );

      const proposals = await askForJson(
        {
          key,
          userId: context.userId,
          deadline,
          model: PLAN_MODEL,
          system: coachSystemPrompt(profile as never, home.text),
          prompt:
            "A un plan del mes ya hecho le faltan platos de bebés de triturados (se dieron de alta después de generar el plan). NO cambies ni menciones el plato de la mesa: solo propón, para CADA hueco de esta lista, el puré o triturado de ese bebé:\n" +
            JSON.stringify(
              items.map((it) => ({
                childId: it.childId,
                nombre: it.name,
                edad: it.age,
                alergias: it.allergies || "ninguna",
                fecha: it.date,
                dia: weekdayName(it.date),
                slot: it.slot,
                platoDeLaMesaEseDia: it.adultDish || "(sin plato de mesa ese día)",
              })),
            ) +
            (available
              ? `\nIngredientes ya en la lista de la compra o en casa: ${available}\n`
              : "\n") +
            'Cada plato: sencillo, sin sal ni azúcar, adaptado a la edad y sin sus alérgenos — normalmente una versión triturada de "platoDeLaMesaEseDia" cuando tenga sentido, o algo sencillo y de temporada si no lo tiene. ' +
            "Devuelve solo JSON: " +
            '{"kids": [objetos {"childId", "fecha", "slot": "comida"|"cena", "dish": plato corto, ' +
            '"off": [ingredientes de ese plato que NO estén ya disponibles, minúsculas, máx. 3, vacío si no falta ninguno]}]}, ' +
            "uno por cada hueco de la lista de arriba, mismo childId/fecha/slot.",
        },
        (parsed) => {
          const o = (parsed ?? {}) as { kids?: unknown };
          const known = new Set(items.map((it) => `${it.childId}|${it.date}|${it.slot}`));
          const out = (Array.isArray(o.kids) ? o.kids : [])
            .map((k) => {
              const r = (k ?? {}) as Record<string, unknown>;
              const childId = String(r.childId ?? "").trim();
              const date = String(r.fecha ?? "").trim();
              const slot =
                r.slot === "cena"
                  ? ("cena" as const)
                  : r.slot === "comida"
                    ? ("comida" as const)
                    : null;
              const dish = String(r.dish ?? "")
                .trim()
                .slice(0, 200);
              if (!slot || !dish || !known.has(`${childId}|${date}|${slot}`)) return null;
              const off = (Array.isArray(r.off) ? r.off : [])
                .map((x) => String(x).trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 3);
              return { childId, date, slot, dish, off };
            })
            .filter((x): x is NonNullable<typeof x> => x != null);
          return out.length ? out : null;
        },
      );

      // Se rellena sobre la versión más reciente de la fila (ticket 21): la IA
      // tarda y entretanto el planificador puede haber puesto un plato a mano,
      // que `onlyIfEmpty` respeta. Lo rellenado se cuenta en esa versión.
      let next = current;
      let filled = 0;
      const filledChildIds = new Set<string>();
      try {
        await updatePlanRowCas(context.supabase as never, context.userId, month, "plan", (r) => {
          const latest = cleanPlan(r.plan);
          if (!latest) return null;
          next = latest;
          filled = 0;
          filledChildIds.clear();
          for (const p of proposals) {
            const after = withChildMeal(next, p.date, p, { onlyIfEmpty: true });
            if (!after || after === next) continue;
            next = after;
            filled++;
            filledChildIds.add(p.childId);
          }
          return filled ? { plan: next } : null;
        });
      } catch (error) {
        console.error("fillChildMeals", error);
        throw new Error("No hemos podido guardar el menú de los peques");
      }

      if (filled) {
        await syncSharedMeals({
          supabase: context.supabase as never,
          userId: context.userId,
          month,
          today: data.today,
        });
      }

      return {
        plan: next,
        filled,
        children: pending
          .map((p) => p.child)
          .filter((c) => filledChildIds.has(c.id))
          .map((c) => c.name),
      };
    },
  );

export type DishRecipe = { ingredients: string[]; steps: string[] };

/**
 * Receta simplificada de un plato, a demanda: se pide solo cuando la persona
 * expande un plato del plan, para no inflar el JSON del plan ni encarecer cada
 * regeneración. Se apoya en los ingredientes ya comprados del mes si los hay.
 */
export const dishRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { dish: string; month?: string }) => {
    const dish = String(input?.dish ?? "")
      .trim()
      .slice(0, 200);
    if (!dish) throw new ValidationError("Falta el plato");
    const month = /^\d{4}-\d{2}$/.test(input?.month ?? "") ? input!.month! : "";
    return { dish, month };
  })
  .handler(async ({ data, context }): Promise<DishRecipe> => {
    const deadline = requestDeadline();
    const key = requireAiKey();

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "recipe");

    let pantry = "";
    if (data.month) {
      const { data: row } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        data.month,
        "shopping",
      );
      pantry = ingredientNames(cleanShopping((row as { shopping?: unknown } | null)?.shopping));
    }

    return askForJson(
      {
        key,
        userId: context.userId,
        deadline,
        system:
          "Eres un cocinero que explica recetas caseras muy simples, en español, con frases cortas y claras, siempre dentro de la dieta mediterránea (verdura, fruta, legumbre, cereal integral, pescado y aceite de oliva virgen extra por delante; carne roja/procesada y ultraprocesados solo de forma ocasional).",
        prompt:
          `Plato: "${data.dish}"\n` +
          (pantry ? `Ingredientes disponibles en casa: ${pantry}\n` : "") +
          "Da una receta simplificada y realista para cocinar en casa. Usa sobre todo los ingredientes disponibles (más sal, aceite, agua y especias básicas). " +
          'Devuelve solo JSON: {"ingredients": [máx. 8 ingredientes con cantidad orientativa, strings cortos], "steps": [3 a 5 pasos cortos y claros]}',
      },
      (parsed) => {
        const o = (parsed ?? {}) as { ingredients?: unknown; steps?: unknown };
        const ingredients = (Array.isArray(o.ingredients) ? o.ingredients : [])
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 8);
        const steps = (Array.isArray(o.steps) ? o.steps : [])
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 6);
        return steps.length ? { ingredients, steps } : null;
      },
    );
  });
