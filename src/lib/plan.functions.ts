import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText, streamText } from "ai";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COACH_MODEL, coachSystemPrompt, createAiProvider } from "@/lib/ai-provider.server";
import {
  describeServings,
  describeSharedSlots,
  isSharedSlot,
  MEAL_KEYS as HOUSEHOLD_MEAL_KEYS,
  type MealKey,
  type SharedSlots,
} from "@/lib/household-shared";
import {
  cadenceOf,
  carryOwnedByName,
  cleanPantryExtras,
  cleanPlan,
  cleanShopping,
  cleanTripActuals,
  cleanTripConfirmations,
  cleanTripReceipts,
  completePlan,
  composeMonthlyPlanForMember,
  coverageRatio,
  daysInMonth,
  formatQty,
  ingredientNames,
  isCanonicalShopping,
  isNextMonthUnlocked,
  mealsForDate,
  mergeFuturePlan,
  monthCoverage,
  nextMonthISO,
  planForDate,
  repartitionTrips,
  tripDayRange,
  tripsOfCadence,
  type PlanCoverage,
  type ShoppingCadence,
  MEAL_SLOTS,
  MEAL_SLOT_FIELD,
  MEAL_SLOT_LABEL,
  parseJsonLoose,
  planCursor,
  planSlotIndex,
  shoppingTotal,
  normName,
  type ChildMeal,
  type MealSlot,
  type MonthlyPlan,
  type PantryExtra,
  type PlanDay,
  type ShoppingList,
  type TripActuals,
  type TripConfirmations,
  type TripReceipts,
} from "@/lib/plan-shared";
import { zonedTodayISO } from "@/lib/zoned-date";
import { ValidationError } from "@/lib/validation-error";

export type { MonthlyPlan, ShoppingItem, ShoppingList } from "@/lib/plan-shared";

/**
 * `MealSlot` (plan-shared, 4 comidas) y `MealKey` (household-shared, issue 03)
 * comparten los mismos 3 nombres para desayuno/comida/cena — solo el snack no
 * tiene equivalente, porque nunca es una comida compartida del hogar (D5).
 */
const mealKeyOf = (slot: MealSlot): MealKey | null => (slot === "snack" ? null : slot);

/**
 * Lee la fila `monthly_plans` PROPIA del que llama para un mes. Se filtra por
 * `user_id` siempre: desde issue 05 hay una policy de SELECT en `monthly_plans`
 * que también deja a un miembro del hogar leer la fila del planificador, así que
 * un `.maybeSingle()` filtrado solo por `month` devolvería 2 filas (y un error
 * PGRST116) cuando lo llama un no planificador. Toda escritura de estas server
 * functions ya usa el mismo filtro `.eq("user_id", context.userId)`; esto lo
 * hace también en la lectura previa.
 */
function ownPlanRow(
  supabase: SupabaseClient<never, never, never>,
  userId: string,
  month: string,
  columns: string,
) {
  return supabase
    .from("monthly_plans")
    .select(columns)
    .eq("month", month)
    .eq("user_id", userId)
    .maybeSingle();
}

/**
 * Fila `monthly_plans` sobre la que se escribe el ESTADO de compra: marcas
 * "lo tengo en casa"/"comprado", gasto real, tiquets, despensa extra y cierre
 * de tramos. En un hogar esa lista vive en la fila del planificador y cualquier
 * miembro con cuenta puede tocar su estado (issue 06) — nunca los platos ni las
 * cantidades.
 *
 *  - Sin hogar, o si quien llama ES el planificador → su propia fila
 *    (`isMine: true`), lectura y escritura con el cliente de sesión.
 *  - Miembro no planificador → la fila del planificador (`isMine: false`); RLS
 *    solo deja LEER esa fila (policy de issue 05), así que las lecturas y
 *    escrituras van con `supabaseAdmin` y limitadas a columnas de estado.
 *
 * La membresía queda verificada por `householdPlannerId`: solo devuelve un id
 * no nulo cuando quien llama es miembro del mismo hogar. Es una sola consulta,
 * mucho más ligera que `householdContext`, porque este camino se recorre en
 * cada marca de "lo tengo en casa".
 */
async function resolveShoppingRow(
  supabase: unknown,
  userId: string,
): Promise<{ targetUserId: string; isMine: boolean }> {
  const { householdPlannerId } = await import("@/lib/household.server");
  const plannerId = await householdPlannerId(supabase as never, userId);
  if (!plannerId || plannerId === userId) {
    return { targetUserId: userId, isMine: true };
  }
  return { targetUserId: plannerId, isMine: false };
}

/** Lee la fila objetivo del estado de compra (propia con el cliente de sesión;
 *  la del planificador con `supabaseAdmin`, ver `resolveShoppingRow`). */
async function readShoppingRow<T>(
  supabase: unknown,
  target: { targetUserId: string; isMine: boolean },
  month: string,
  columns: string,
): Promise<T | null> {
  if (target.isMine) {
    const { data } = await ownPlanRow(supabase as never, target.targetUserId, month, columns);
    return (data as T | null) ?? null;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("monthly_plans")
    .select(columns)
    .eq("user_id", target.targetUserId)
    .eq("month", month)
    .maybeSingle();
  return (data as T | null) ?? null;
}

/** Escribe SOLO columnas de estado de compra en la fila objetivo. El `patch`
 *  nunca incluye `plan` ni `weekQty`: un no planificador jamás toca los platos
 *  ni las cantidades de la lista de la casa (issue 06). */
async function writeShoppingState(
  supabase: unknown,
  target: { targetUserId: string; isMine: boolean },
  month: string,
  patch: Record<string, unknown>,
): Promise<{ error: unknown }> {
  if (target.isMine) {
    const { error } = await (supabase as SupabaseClient<never, never, never>)
      .from("monthly_plans")
      .update(patch as never)
      .eq("month", month)
      .eq("user_id", target.targetUserId);
    return { error };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin
    .from("monthly_plans")
    .update(patch as never)
    .eq("user_id", target.targetUserId)
    .eq("month", month);
  return { error };
}

/**
 * Si esa comida de ese día es compartida y quien llama NO es quien planifica
 * en casa, el cambio no es suyo que hacer (D2). `date` decide el día de la
 * semana; si no hay hogar o la comida no se comparte, no hay nada que impedir.
 */
async function guardSharedSlotWrite(
  supabase: unknown,
  userId: string,
  date: string,
  slot: MealSlot,
): Promise<void> {
  const mealKey = mealKeyOf(slot);
  if (!mealKey) return;
  const { householdContext } = await import("@/lib/household.server");
  const home = await householdContext(supabase as never, userId);
  if (!home.plannerId || home.plannerId === userId) return;
  const weekday = planCursor(date).dayIndex;
  if (!isSharedSlot(home.sharedSlots, mealKey, weekday)) return;
  const plannerName =
    home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
  throw new ValidationError(
    `Esa comida la lleva ${plannerName} de tu casa. Puedo cambiar tus comidas en solitario.`,
  );
}

/**
 * Vacía en un plan las comidas que ese día son compartidas del hogar. Lo usa
 * el modo "solo mis comidas" de un no planificador: su fila `monthly_plans`
 * no debe guardar el plato de una comida de la casa (lo pone el espejo /
 * la composición en lectura). El desayuno se comparte "todo o nada" a nivel
 * de rotación semanal, igual que en `syncSharedMeals` / `composeDayForUser`.
 */
function blankSharedSlots(plan: MonthlyPlan, sharedSlots: SharedSlots): MonthlyPlan {
  const desayunoShared = sharedSlots.desayuno.length > 0;
  return {
    ...plan,
    weeks: plan.weeks.map((week) => ({
      ...week,
      breakfasts: desayunoShared ? [] : week.breakfasts,
      days: week.days.map((day, di) => {
        const next: PlanDay = { ...day };
        if (isSharedSlot(sharedSlots, "comida", di)) next.lunch = "";
        if (isSharedSlot(sharedSlots, "cena", di)) next.dinner = "";
        if (desayunoShared) delete next.breakfast;
        // Los platos aparte de un niño (issue 07) los lleva el planificador:
        // la fila de un no planificador solo conserva los de un slot que ese
        // día no sea compartido (raro), el resto los pone el espejo.
        const kids = (next.kids ?? []).filter(
          (k) => k.slot !== "snack" && !isSharedSlot(sharedSlots, k.slot, di),
        );
        if (kids.length) next.kids = kids;
        else delete next.kids;
        return next;
      }),
    })),
  };
}

/** Pide el JSON al modelo en streaming (evita cortes por timeout) y lo intenta varias veces. */
async function askForJson<T>(
  opts: { key: string; system: string; prompt: string },
  extract: (parsed: unknown) => T | null,
  attempts = 3,
): Promise<T> {
  const ai = createAiProvider(opts.key);
  let lastError: unknown = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const result = streamText({
        model: ai(COACH_MODEL),
        system: opts.system,
        prompt:
          i === 0
            ? opts.prompt
            : `${opts.prompt}\n\nIMPORTANTE: el intento anterior no fue válido. Devuelve EXCLUSIVAMENTE el JSON completo y cerrado, sin markdown, sin comentarios y sin texto antes o después.`,
        temperature: i === 0 ? 0.7 : 0.3,
      });
      const text = await result.text;
      const value = extract(parseJsonLoose(text));
      if (value) return value;
      lastError = new Error("JSON incompleto");
    } catch (e) {
      lastError = e;
    }
  }

  console.error("askForJson agotó los intentos", lastError);
  throw new Error("No hemos podido crear el plan ahora mismo. Inténtalo otra vez en un momento.");
}

/**
 * Garantiza que la lista no supere el presupuesto. Primero pide al modelo que la
 * recorte con números concretos; si aun así se pasa, escala la compra de forma
 * proporcional como último recurso (`scaleShoppingToBudget`: cantidad y precio a
 * la vez) para que el total nunca exceda el tope. Es best-effort: si el recorte
 * por IA falla, no rompe la generación.
 */
async function enforceBudget(
  key: string,
  system: string,
  shopping: ShoppingList,
  target: number,
): Promise<ShoppingList> {
  if (!(target > 0) || shoppingTotal(shopping) <= target * 1.02) return shopping;

  let result = shopping;
  try {
    const ai = createAiProvider(key);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      system,
      temperature: 0.2,
      prompt:
        `Lista de la compra actual (JSON): ${JSON.stringify(shopping)}\n` +
        `Suma ${shoppingTotal(shopping)} € y el tope es ${target} €.\n` +
        `Recórtala hasta NO superar ${target} €: baja "weekQty" y "weekPrice" a la vez, elige alternativas más baratas y quita lo prescindible, manteniendo una compra equilibrada y platos cocinables. ` +
        "Conserva EXACTAMENTE la misma estructura (claves category/items/name/unit/weekQty/weekPrice/perishable; weekQty y weekPrice son arrays de 4, uno por semana). " +
        'Devuelve solo JSON: {"shopping": [...]}',
    });
    const parsed = (parseJsonLoose(text) ?? {}) as { shopping?: unknown };
    const cleaned = cleanShopping(parsed.shopping ?? parsed);
    if (cleaned.length) result = cleaned;
  } catch (e) {
    console.error("enforceBudget", e);
  }

  const total = shoppingTotal(result);
  if (total > target && total > 0) {
    result = scaleShoppingToBudget(result, target / total);
  }
  return result;
}

/**
 * Último recurso si el recorte por IA no bastó: escala la compra por un factor
 * < 1. En la lista canónica baja `weekQty` y `weekPrice` juntos (bajar solo el
 * precio dejaría cantidad y coste contradiciéndose); en una lista antigua solo
 * puede tocar el precio.
 */
const scaleShoppingToBudget = (shopping: ShoppingList, factor: number): ShoppingList =>
  shopping.map((g) => ({
    ...g,
    items: g.items.map((i) => {
      if (Array.isArray(i.weekQty)) {
        const weekQty = i.weekQty.map((n) => Math.round(n * factor * 100) / 100);
        const weekPrice = (i.weekPrice ?? []).map((n) => Math.round(n * factor * 100) / 100);
        return {
          ...i,
          weekQty,
          weekPrice,
          qty: formatQty(
            weekQty.reduce((s, n) => s + n, 0),
            i.unit ?? "ud",
          ),
          price_eur: Math.round(weekPrice.reduce((s, n) => s + n, 0) * 100) / 100,
        };
      }
      return { ...i, price_eur: Math.round(i.price_eur * factor * 100) / 100 };
    }),
  }));

export const generateMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; cadence?: ShoppingCadence; today?: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    // No se planifica el pasado (no se puede cumplir y gasta tokens) ni más allá
    // del mes que viene, y este último solo en su última semana — mismo umbral
    // con el que la pantalla Plan lo desbloquea (ver `isNextMonthUnlocked`).
    // `today` lo manda el cliente en su zona horaria; el fallback es Madrid.
    const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
    const currentMonth = today.slice(0, 7);
    if (input.month < currentMonth) throw new ValidationError("No se planifican meses pasados");
    const nm = nextMonthISO(today);
    if (input.month > nm) throw new ValidationError("Solo puedes preparar hasta el mes que viene");
    if (input.month === nm && !isNextMonthUnlocked(today)) {
      throw new ValidationError(
        "Aún no toca preparar el mes que viene; podrás la última semana del mes",
      );
    }
    const cadence: ShoppingCadence =
      input?.cadence === "semanal" || input?.cadence === "bisemanal" ? input.cadence : "mensual";
    return { month: input.month, cadence, today };
  })
  .handler(async ({ data, context }): Promise<{ plan: MonthlyPlan; shopping: ShoppingList }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();

    const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
    const home = await householdContext(context.supabase as never, context.userId);

    const today = data.today;
    const coverage = monthCoverage(data.month, today);
    const coveredDays = coverage.toDay - coverage.fromDay + 1;
    const ratio = coverageRatio(coverage, data.month);

    const rawBudget = Number(
      (profile as { budget_month_eur?: number | null } | null)?.budget_month_eur,
    );
    const budget = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : 0;
    // Presupuesto prorrateado a los días que cubre el plan: un plan que empieza a
    // media de mes solo puede gastar la parte proporcional del mes que le queda.
    const proratedBudget = budget > 0 ? Math.round(budget * ratio) : 0;
    const budgetLine =
      proratedBudget > 0
        ? `El coste total de la lista de la compra NO puede superar ${proratedBudget} € para el periodo que cubre el plan. Ajusta cantidades y elige alimentos económicos hasta encajar en ese presupuesto.`
        : "Ajusta la lista a un presupuesto contenido y realista de supermercado en España.";

    const coverageLine =
      coverage.fromDay > 1
        ? `IMPORTANTE: este plan empieza a media de mes. Cubre SOLO del día ${coverage.fromDay} al ${coverage.toDay} de este mes (${coveredDays} días). La lista de la compra y todas las comidas son únicamente para esos días; no planifiques ni compres para días anteriores al ${coverage.fromDay}.`
        : `El plan cubre el mes completo (días 1 al ${coverage.toDay}).`;

    const trips = tripsOfCadence(data.cadence);
    const tripRanges = Array.from({ length: trips }, (_, t) => {
      const { from, to } = tripDayRange(coverage, trips, t);
      return `días ${from}-${to}`;
    });
    const cadenceLine =
      trips === 1
        ? "COMPRA MENSUAL: la persona hará UNA sola compra para todo el periodo. Apóyate en despensa, congelados, conservas, legumbre seca, huevos, tubérculos y verdura resistente. Puedes incluir algún fresco, pero el que no aguante ~2 semanas se comprará aparte sobre la marcha (se le avisa en pantalla), así que no cargues la compra de pescado, verdura de hoja ni fruta blanda."
        : `COMPRA REPARTIDA en ${trips} compras (${tripRanges.join(" / ")}). No asignes compras a mano: con el "weekQty" por semana basta, el sistema calcula cuánto lleva cada compra. Reparte los frescos por las semanas en que se usan para que no se acumulen.`;

    const coveredWeeksNote =
      coverage.fromDay > 1
        ? `Pon 0 en "weekQty"/"weekPrice" de las semanas del mes anteriores al día ${coverage.fromDay} (este plan no las cubre). `
        : "";

    // No planificador (issue 05, D1): genera SOLO sus comidas en solitario —
    // las compartidas ya las cubre el plan del planificador, que se espeja
    // por lectura (`fetchMonthlyPlan`/`composeMonthlyPlanForMember`) y por
    // escritura (`syncSharedMeals`). No es el planificador ni un usuario en
    // solitario si `plannerId` existe y no es quien llama.
    const isNonPlannerInHousehold = !!home.plannerId && home.plannerId !== context.userId;
    const plannerName =
      home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
    const myPortion = home.members.find((m) => m.userId === context.userId)?.portion ?? 1;

    // Raciones exactas del hogar (issue 04): sustituye la frase vaga de "cubre
    // las raciones extra" por la tabla real que ya calculó `householdContext`,
    // para que la IA dimensione `weekQty` sin adivinar cuánta gente come.
    const servingsLine = isNonPlannerInHousehold
      ? `SOLO TUS COMIDAS EN SOLITARIO: en tu casa, ${describeSharedSlots(home.sharedSlots)} ya las cubre el plan de ${plannerName} — NO las incluyas ni en "plan" ni en "shopping" (deja esos campos de "lunch"/"dinner" vacíos, "" ). Dimensiona lo que sí planifiques para ${myPortion} ración(es). `
      : home.householdId && HOUSEHOLD_MEAL_KEYS.some((m) => home.sharedSlots[m].length)
        ? `RACIONES: ${describeServings(home.servings, home.sharedSlots)} (mismo plato para toda la mesa esos días, sin los alérgenos de los niños). Las comidas en solitario (snack, y las que no compartes) piden ${home.servings.plannerSolo} ración(es). Dimensiona cada "weekQty" para esas raciones exactas, ni de más ni de menos. `
        : "";

    // Plato aparte de un niño (issue 07): solo lo genera el planificador (o un
    // usuario en solitario con niños en casa, caso raro pero posible).
    const kidsLine =
      !isNonPlannerInHousehold && home.children.length
        ? `NIÑOS DE LA CASA: ${JSON.stringify(
            home.children.map((c) => ({
              childId: c.id,
              nombre: c.name,
              edad: c.age,
              alergias: c.allergies || "ninguna",
              racion: c.portion,
            })),
          )}. Si un plato compartido no le sirve a un niño (lleva su alérgeno, no encaja con su edad, o no se lo va a comer), añade para ESE niño ESE día un plato alternativo sencillo en "days[].kids" — objeto {"childId" (el de la lista), "slot": "desayuno"|"comida"|"cena", "dish": plato corto} — y suma sus ingredientes al "weekQty" a ración de ese niño. Si el plato compartido le vale, no pongas nada: por defecto el niño come lo mismo que la mesa. `
        : "";

    const { plan: rawPlan, shopping: rawShopping } = await askForJson(
      {
        key,
        system: coachSystemPrompt(profile as never, home.text),
        prompt:
          `Crea el plan del mes ${data.month} y su lista de la compra. Devuelve solo JSON válido:\n` +
          '{"shopping": [objetos {"category": "Verdura y fruta"|"Proteína"|"Despensa"|"Lácteos"|"Otros", ' +
          '"items": [{"name": string (ingrediente), "unit": "g"|"ml"|"ud" (g para sólidos, ml para líquidos, ud para piezas/manojos/latas), ' +
          '"weekQty": [4 números] (cantidad en "unit" que piden los platos de CADA semana del mes para las raciones del hogar; 0 si esa semana no se usa), ' +
          '"weekPrice": [4 números] (€ orientativo de supermercado en España para la cantidad de cada semana), ' +
          '"perishable": boolean (true si es fresco y aguanta pocos días)}]}], ' +
          '"plan": {"intro": string (2 frases motivadoras y comprensivas), "focus": [3 focos del mes, cortos], ' +
          '"weeks": [4 objetos {"label": "Semana 1".."Semana 4", "focus": string corto, "breakfasts": [2 ideas de desayuno], "snacks": [2 ideas de snack], ' +
          '"days": [7 objetos {"day": "Lunes".."Domingo", "lunch": plato, "dinner": plato, "kids": [opcional, solo si un niño necesita otro plato: {"childId", "slot": "desayuno"|"comida"|"cena", "dish"}]}]}]}}\n' +
          "REGLA CLAVE: todos los platos, desayunos y snacks del plan deben poder prepararse ÚNICAMENTE con los ingredientes de la lista de la compra (más sal, aceite, agua y especias básicas). No menciones ningún alimento que no esté en la lista. " +
          'CANTIDADES: cada número de "weekQty" es lo que de verdad piden los platos de esa semana, ni de más ni de menos. Si un plato se repite en varias semanas, refleja su parte en el "weekQty" de cada una. ' +
          `${coverageLine} ${coveredWeeksNote}` +
          `${budgetLine} ` +
          `${cadenceLine} ` +
          "FRESCURA: marca perishable=true en frescos (verdura de hoja, pescado, carne fresca, fruta blanda, lácteos frescos) y false en despensa, congelados y conservas. " +
          "Ten en cuenta cuándo cocina y come en casa y cuándo come fuera: en las comidas fuera de casa propón una opción de menú o restaurante y no cuentes sus ingredientes en la compra. " +
          `${servingsLine}` +
          `${kidsLine}` +
          "Platos sencillos, repetibles y realistas (puedes repetir platos entre semanas). Frases cortas para que el JSON quepa completo. Sin gramajes rígidos en los platos. Sin markdown ni explicaciones.",
      },
      (parsed) => {
        const p = (parsed ?? {}) as { plan?: unknown; shopping?: unknown };
        const plan = completePlan(cleanPlan(p.plan));
        const shopping = cleanShopping(p.shopping);
        if (!plan || !shopping.length) return null;
        return { plan, shopping };
      },
    );

    // Deja la lista dentro del presupuesto prorrateado y fija la cadencia/cobertura
    // del plan como fuente de verdad para las etiquetas de días y compras.
    const shopping = await enforceBudget(
      key,
      coachSystemPrompt(profile as never, home.text),
      rawShopping,
      proratedBudget,
    );
    // Cinturón para el modo "solo mis comidas": si la IA rellenó igualmente
    // una comida compartida, se vacía aquí — la fila de un no planificador
    // nunca guarda el plato de una comida de la casa (lo pone el espejo).
    const planBody = isNonPlannerInHousehold
      ? blankSharedSlots(rawPlan, home.sharedSlots)
      : rawPlan;
    const plan: MonthlyPlan = { ...planBody, coverage, cadence: data.cadence };

    const { error } = await context.supabase.from("monthly_plans").upsert(
      {
        user_id: context.userId,
        month: data.month,
        plan: plan as never,
        shopping: shopping as never,
        confirmed_at: null,
      } as never,
      { onConflict: "user_id,month" },
    );
    if (error) {
      console.error("saveMonthlyPlan", error);
      throw new Error("No hemos podido guardar el plan del mes. Inténtalo otra vez.");
    }

    await syncSharedMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      month: data.month,
      today,
    });

    return { plan, shopping };
  });

/**
 * Cambia la cadencia de compra (semanal/bisemanal/mensual). No regenera el plan
 * ni llama a la IA: la lista canónica ya guarda el desglose por semana, así que
 * cambiar de cadencia solo cambia cómo se agrupa en pantalla (`projectTrips`).
 * Una lista antigua (sin desglose) se reparte con `repartitionTrips` como antes,
 * y `carryOwnedByName` conserva las marcas "en casa"/"comprado".
 */
export const recadenceMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; cadence?: ShoppingCadence }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const cadence: ShoppingCadence =
      input?.cadence === "semanal" || input?.cadence === "bisemanal" ? input.cadence : "mensual";
    return { month: input.month, cadence };
  })
  .handler(async ({ data, context }): Promise<{ plan: MonthlyPlan; shopping: ShoppingList }> => {
    const { data: row } = await ownPlanRow(
      context.supabase as never,
      context.userId,
      data.month,
      "plan, shopping",
    );
    const typed = row as { plan?: unknown; shopping?: unknown } | null;

    const current = cleanPlan(typed?.plan);
    if (!current) throw new ValidationError("Todavía no hay plan de este mes");
    const prevShopping = cleanShopping(typed?.shopping);
    const shopping = isCanonicalShopping(prevShopping)
      ? prevShopping
      : carryOwnedByName(prevShopping, repartitionTrips(prevShopping, data.cadence));
    const plan: MonthlyPlan = { ...current, cadence: data.cadence };

    const { error } = await context.supabase
      .from("monthly_plans")
      .update({ plan: plan as never, shopping: shopping as never } as never)
      .eq("month", data.month)
      .eq("user_id", context.userId);
    if (error) {
      console.error("recadenceMonthlyPlan", error);
      throw new Error("No hemos podido cambiar la frecuencia de la compra");
    }

    return { plan, shopping };
  });

/**
 * Marca un ingrediente como comprado ("fridge": ya lo tenía en casa, "store":
 * lo ha comprado en el súper) o lo deja sin decidir (source null) — no cambia
 * la lista en sí (cantidades y precio siguen igual), solo anota de dónde ha
 * salido cada uno. La marca es por ingrediente Y compra: un mismo fresco puede
 * hacer falta en varias compras y marcar una no marca las demás. En la lista
 * canónica eso vive en `ownedTrips[trip]`; en una lista antigua, en el `owned`
 * de la fila de ese `trip`.
 */
export const toggleShoppingOwned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      month: string;
      itemName: string;
      trip: number;
      source: "fridge" | "store" | null;
    }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
      const itemName = String(input?.itemName ?? "").trim();
      if (!itemName) throw new ValidationError("Falta el ingrediente");
      const trip = Number(input?.trip);
      if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
      const source = input?.source === "fridge" || input?.source === "store" ? input.source : null;
      return { month: input.month, itemName, trip: Math.round(trip), source };
    },
  )
  .handler(async ({ data, context }): Promise<{ shopping: ShoppingList }> => {
    // La lista puede ser la de la casa: cualquier miembro con cuenta marca su
    // estado, aunque la escritura vaya a la fila del planificador (issue 06).
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const row = await readShoppingRow<{ shopping?: unknown }>(
      context.supabase,
      target,
      data.month,
      "shopping",
    );
    const current = cleanShopping(row?.shopping);
    if (!current.length) throw new ValidationError("Todavía no hay lista de la compra este mes");

    const shopping: ShoppingList = current.map((group) => ({
      category: group.category,
      items: group.items.map((item) => {
        if (item.name !== data.itemName) return item;
        if (Array.isArray(item.weekQty)) {
          const ownedTrips = { ...(item.ownedTrips ?? {}) };
          if (data.source) ownedTrips[data.trip] = data.source;
          else delete ownedTrips[data.trip];
          const { ownedTrips: _drop, ...rest } = item;
          return Object.keys(ownedTrips).length ? { ...rest, ownedTrips } : rest;
        }
        if (item.trip !== data.trip) return item;
        if (!data.source) {
          const { owned: _owned, ...rest } = item;
          return rest;
        }
        return { ...item, owned: data.source };
      }),
    }));

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      shopping: shopping as never,
    });
    if (error) {
      console.error("toggleShoppingOwned", error);
      throw new Error("No hemos podido guardar el cambio");
    }

    return { shopping };
  });

/**
 * Guarda lo que se ha gastado de verdad en un viaje de compra concreto. Los
 * precios de `shopping` son la estimación de la IA hecha al generar el plan;
 * esto es aparte y no los toca, para poder comparar estimado contra real.
 */
export const setTripActual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; trip: number; amount: number | null }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
    const amount = input?.amount == null ? null : Number(input.amount);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      throw new ValidationError("Importe no válido");
    }
    return { month: input.month, trip: Math.round(trip), amount };
  })
  .handler(async ({ data, context }): Promise<{ trip_actuals: TripActuals }> => {
    // El gasto real de la compra de la casa lo puede anotar cualquier miembro
    // (issue 06): resuelve la fila objetivo y escribe solo esa columna.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const row = await readShoppingRow<{ trip_actuals?: unknown }>(
      context.supabase,
      target,
      data.month,
      "trip_actuals",
    );
    const current = cleanTripActuals(row?.trip_actuals);
    const next = { ...current };
    if (data.amount == null) delete next[data.trip];
    else next[data.trip] = data.amount;

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      trip_actuals: next as never,
    });
    if (error) {
      console.error("setTripActual", error);
      throw new Error("No hemos podido guardar el gasto");
    }

    return { trip_actuals: next };
  });

/**
 * Añade o quita un ingrediente de la "despensa extra" del mes: cosas que la
 * persona ya tiene en casa y NO salen de la lista de la compra (añadidas a mano
 * o detectadas al escanear un tiquet). El planificador las trata como
 * disponibles al recolocar los días futuros; la lista de la compra (`shopping`)
 * no se toca nunca por esto. El emparejamiento al quitar es por nombre
 * normalizado (`normName`), no por igualdad exacta.
 */
export const setPantryExtra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; name: string; qty?: string; remove?: boolean }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const name = String(input?.name ?? "")
      .trim()
      .slice(0, 80);
    if (!name) throw new ValidationError("Falta el ingrediente");
    const qty = String(input?.qty ?? "")
      .trim()
      .slice(0, 40);
    return { month: input.month, name, qty, remove: Boolean(input?.remove) };
  })
  .handler(async ({ data, context }): Promise<{ pantry_extras: PantryExtra[] }> => {
    // La despensa "ya lo tenemos en casa" es del hogar (issue 06): cualquier
    // miembro la edita, aunque viva en la fila del planificador.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const row = await readShoppingRow<{ pantry_extras?: unknown }>(
      context.supabase,
      target,
      data.month,
      "pantry_extras",
    );
    const current = cleanPantryExtras(row?.pantry_extras);
    const key = normName(data.name);
    const withoutIt = current.filter((e) => normName(e.name) !== key);
    const next: PantryExtra[] = data.remove
      ? withoutIt
      : [
          ...withoutIt,
          {
            name: data.name,
            ...(data.qty ? { qty: data.qty } : {}),
            source: "manual" as const,
            addedAt: new Date().toISOString(),
          },
        ].slice(0, 40);

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      pantry_extras: next as never,
    });
    if (error) {
      console.error("setPantryExtra", error);
      throw new Error("No hemos podido guardar el ingrediente");
    }

    return { pantry_extras: next };
  });

export type ReceiptScan = {
  trip_actuals: TripActuals;
  pantry_extras: PantryExtra[];
  trip_receipts: TripReceipts;
  total: number;
  itemCount: number;
  added: string[];
  discarded: { name: string; reason: string }[];
};

/**
 * Lee la foto de un tiquet de compra con el modelo de visión y hace dos cosas
 * sin tocar nunca la lista de la compra (`shopping`):
 *  1. Guarda el importe real de la compra en `trip_actuals[trip]` (misma columna
 *     que el gasto a mano) y un resumen en `trip_receipts[trip]`.
 *  2. De los productos del tiquet que NO estén ya cubiertos por la compra ni por
 *     la despensa extra, añade a `pantry_extras` los que encajan en los
 *     objetivos y la dieta de la persona (`source: "receipt"`) y descarta el
 *     resto devolviendo el motivo, para enseñarlo en pantalla.
 * La imagen no se guarda: se manda al modelo y se descarta.
 */
export const scanTripReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; trip: number; imageBase64: string; mime?: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
    const imageBase64 = String(input?.imageBase64 ?? "").trim();
    if (!imageBase64) throw new ValidationError("Falta la foto del tiquet");
    if (imageBase64.length > 4_500_000) {
      throw new ValidationError(
        "La foto es demasiado grande: baja la calidad e inténtalo otra vez",
      );
    }
    const mime = /^image\/(jpeg|png|webp|heic)$/.test(input?.mime ?? "")
      ? input!.mime!
      : "image/jpeg";
    return { month: input.month, trip: Math.round(trip), imageBase64, mime };
  })
  .handler(async ({ data, context }): Promise<ReceiptScan> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    // La foto del tiquet la sube quien va al súper — puede no ser el
    // planificador (issue 06). El perfil para clasificar los productos es
    // siempre el de quien llama; la fila de compra, la que resuelva el hogar.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const [{ data: profile }, row] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      readShoppingRow<{
        shopping?: unknown;
        pantry_extras?: unknown;
        trip_actuals?: unknown;
        trip_receipts?: unknown;
      }>(
        context.supabase,
        target,
        data.month,
        "shopping, pantry_extras, trip_actuals, trip_receipts",
      ),
    ]);
    const typed = row;
    const shopping = cleanShopping(typed?.shopping);
    const pantryExtras = cleanPantryExtras(typed?.pantry_extras);
    const tripActuals = cleanTripActuals(typed?.trip_actuals);
    const tripReceipts = cleanTripReceipts(typed?.trip_receipts);

    const ai = createAiProvider(key);
    const dataUrl = `data:${data.mime};base64,${data.imageBase64}`;

    // 1) Leer el tiquet (visión).
    const receipt = await (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { text } = await generateText({
            model: ai(COACH_MODEL),
            temperature: 0,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      "Esta es la foto de un tiquet de compra de supermercado en España. " +
                      "Extrae el importe total pagado y la lista de productos con su precio. " +
                      "Ignora descuentos, puntos, IVA desglosado y medios de pago. " +
                      'Devuelve SOLO JSON: {"total_eur": number, "store": string, "items": [{"name": string (producto, en minúsculas y sin marca si se puede), "price_eur": number}]}. ' +
                      "Sin markdown ni texto alrededor.",
                  },
                  { type: "image", image: dataUrl },
                ],
              },
            ],
          });
          const parsed = (parseJsonLoose(text) ?? {}) as {
            total_eur?: unknown;
            store?: unknown;
            items?: unknown;
          };
          const total = Number(parsed.total_eur);
          const items = (Array.isArray(parsed.items) ? parsed.items : [])
            .map((it) => {
              const o = (it ?? {}) as Record<string, unknown>;
              const name = String(o.name ?? "")
                .trim()
                .toLowerCase()
                .slice(0, 80);
              const price = Number(o.price_eur);
              return name
                ? { name, price_eur: Number.isFinite(price) && price >= 0 ? price : 0 }
                : null;
            })
            .filter((x): x is { name: string; price_eur: number } => Boolean(x))
            .slice(0, 80);
          if (Number.isFinite(total) && total >= 0) {
            return {
              total: Math.round(total * 100) / 100,
              store: String(parsed.store ?? ""),
              items,
            };
          }
        } catch (e) {
          console.error("scanTripReceipt vision", e);
        }
      }
      throw new Error("No hemos podido leer el tiquet. Prueba con una foto más nítida.");
    })();

    // 2) Quitar lo que ya está cubierto (mismo nombre exacto) y clasificar el
    // resto: el modelo decide, viendo la lista de la compra, si un producto ya
    // lo tiene por un equivalente ("tomate pera" lo cubre "tomate triturado"),
    // si encaja con sus objetivos, o si se descarta.
    const availableNames = new Set([
      ...shopping.flatMap((g) => g.items.map((i) => normName(i.name))),
      ...pantryExtras.map((e) => normName(e.name)),
    ]);
    const candidateItems = receipt.items.filter((i) => !availableNames.has(normName(i.name)));
    const boughtList = ingredientNames(shopping);

    let added: string[] = [];
    const discarded: { name: string; reason: string }[] = [];

    if (candidateItems.length) {
      try {
        const { text } = await generateText({
          model: ai(COACH_MODEL),
          system: coachSystemPrompt(profile as never),
          temperature: 0.2,
          prompt:
            `Ingredientes que ya tiene comprados este mes: ${boughtList || "ninguno"}\n\n` +
            `Productos del tiquet a clasificar: ${JSON.stringify(candidateItems.map((i) => i.name))}\n\n` +
            "Para cada producto elige una opción:\n" +
            '- "cubierto": ya lo tiene por un equivalente de la lista de arriba (p. ej. "tomate pera" lo cubre "tomate triturado", "aceite oliva 1l" lo cubre "aceite de oliva virgen extra").\n' +
            '- "encaja": es nuevo y sirve para sus platos (base mediterránea; respeta sus restricciones, alergias, patrón de alimentación y objetivo).\n' +
            '- "descartar": es un ultraprocesado, un capricho o choca con sus restricciones o su objetivo.\n' +
            'Devuelve SOLO JSON: {"decisiones": [{"name": string (igual que te lo doy), "estado": "cubierto"|"encaja"|"descartar", "motivo": string (máx. 8 palabras, solo si "descartar")}]}. Sin markdown.',
        });
        const parsed = (parseJsonLoose(text) ?? {}) as { decisiones?: unknown };
        const decisions = new Map<string, { estado: string; motivo: string }>();
        for (const d of Array.isArray(parsed.decisiones) ? parsed.decisiones : []) {
          const o = (d ?? {}) as Record<string, unknown>;
          const name = String(o.name ?? "")
            .trim()
            .toLowerCase();
          if (name) {
            decisions.set(normName(name), {
              estado: String(o.estado ?? "encaja"),
              motivo: String(o.motivo ?? "").trim(),
            });
          }
        }
        for (const item of candidateItems) {
          const d = decisions.get(normName(item.name));
          if (d?.estado === "cubierto") continue;
          if (d?.estado === "descartar") {
            discarded.push({ name: item.name, reason: d.motivo || "no encaja con tu objetivo" });
          } else {
            added.push(item.name);
          }
        }
      } catch (e) {
        // Si la clasificación falla, no inventamos: se descartan todos con un
        // motivo genérico en vez de meter cosas raras en la despensa.
        console.error("scanTripReceipt classify", e);
        for (const item of candidateItems) {
          discarded.push({ name: item.name, reason: "no se pudo comprobar" });
        }
        added = [];
      }
    }

    // 3) Persistir: importe real + resumen del tiquet + extras que encajan.
    const nextActuals: TripActuals = { ...tripActuals, [data.trip]: receipt.total };
    const nextReceipts: TripReceipts = {
      ...tripReceipts,
      [data.trip]: {
        total: receipt.total,
        itemCount: receipt.items.length,
        scannedAt: new Date().toISOString(),
      },
    };
    const nowIso = new Date().toISOString();
    const nextPantry = cleanPantryExtras([
      ...pantryExtras,
      ...added.map((name) => ({ name, source: "receipt" as const, addedAt: nowIso })),
    ]);

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      trip_actuals: nextActuals as never,
      trip_receipts: nextReceipts as never,
      pantry_extras: nextPantry as never,
    });
    if (error) {
      console.error("scanTripReceipt save", error);
      throw new Error("Hemos leído el tiquet pero no hemos podido guardarlo. Inténtalo otra vez.");
    }

    return {
      trip_actuals: nextActuals,
      pantry_extras: nextPantry,
      trip_receipts: nextReceipts,
      total: receipt.total,
      itemCount: receipt.items.length,
      added,
      discarded,
    };
  });

/**
 * "Fija" (o deshace) los ingredientes de un tramo de compra: la persona
 * confirma que ese tramo ya está resuelto (comprado o en casa) y deja de
 * pedir más marcas. Cuando quedan fijados TODOS los tramos del mes, también
 * marca `confirmed_at` del plan — es la señal que ya usa `syncSharedMeals`
 * para no tocar la compra de alguien cuyo mes ya está cerrado del todo; si se
 * deshace cualquier tramo, `confirmed_at` se limpia otra vez.
 */
export const setTripConfirmed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; trip: number; confirmed: boolean }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
    return { month: input.month, trip: Math.round(trip), confirmed: Boolean(input?.confirmed) };
  })
  .handler(async ({ data, context }): Promise<{ confirmed_trips: TripConfirmations }> => {
    // Fijar un tramo de la compra de la casa lo puede hacer cualquier miembro
    // (issue 06); `confirmed_at` se cierra en la fila del planificador cuando
    // todos los tramos quedan fijados — `syncSharedMeals` lo respeta.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const typed = await readShoppingRow<{
      plan?: unknown;
      shopping?: unknown;
      confirmed_trips?: unknown;
    }>(context.supabase, target, data.month, "plan, shopping, confirmed_trips");
    const shopping = cleanShopping(typed?.shopping);
    if (!shopping.length) throw new ValidationError("Todavía no hay lista de la compra este mes");

    const current = cleanTripConfirmations(typed?.confirmed_trips);
    const next = { ...current };
    if (data.confirmed) next[data.trip] = zonedTodayISO();
    else delete next[data.trip];

    // El número "oficial" de tramos es el de la cadencia guardada, no el que se
    // deduzca de los datos (un tramo sin artículos asignados no debe contar de
    // menos y dar por fijado el mes entero antes de tiempo).
    const cadence = cleanPlan(typed?.plan)?.cadence ?? cadenceOf(shopping);
    const allConfirmed = Object.keys(next).length >= tripsOfCadence(cadence);

    const { error } = await writeShoppingState(context.supabase, target, data.month, {
      confirmed_trips: next as never,
      confirmed_at: allConfirmed ? new Date().toISOString() : null,
    });
    if (error) {
      console.error("setTripConfirmed", error);
      throw new Error("No hemos podido fijar los ingredientes");
    }

    return { confirmed_trips: next };
  });

export const adjustMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { month: string; note: string; today?: string; kcalDelta?: number | null }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
      const kcal = Number(input?.kcalDelta);
      return {
        month: input.month,
        note: String(input?.note ?? "").slice(0, 1500),
        today,
        kcalDelta: Number.isFinite(kcal) && kcal !== 0 ? Math.round(kcal) : null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<{ plan: MonthlyPlan; summary: string }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { data: row } = await ownPlanRow(
      context.supabase as never,
      context.userId,
      data.month,
      "plan, shopping, pantry_extras",
    );
    const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
    const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
    const pantryExtras = cleanPantryExtras(
      (row as { pantry_extras?: unknown } | null)?.pantry_extras,
    );
    if (!current) throw new ValidationError("Todavía no hay plan de este mes");

    const [{ data: profile }, { data: logs }] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      context.supabase
        .from("daily_logs")
        .select("log_date, weight_kg, habits, mood, notes")
        .eq("user_id", context.userId)
        .lte("log_date", data.today)
        .order("log_date", { ascending: false })
        .limit(7),
    ]);

    const p = (profile ?? {}) as Record<string, unknown>;
    const cursor = planCursor(data.today);
    const goalLine = p.goal_type
      ? `Objetivo: ${String(p.goal_type)} ${p.goal_amount ?? ""} kg, fecha objetivo ${String(p.goal_target_date ?? "sin fecha")}, peso actual ${String(p.current_weight_kg ?? "?")} kg, peso inicial ${String(p.start_weight_kg ?? "?")} kg.`
      : "La persona no tiene un objetivo de peso definido: no asumas uno ni recoloques el plan para adelgazar; céntrate en comidas equilibradas y hábitos.";
    const kcalLine = data.kcalDelta
      ? data.kcalDelta > 0
        ? `Hoy hay un EXCESO estimado de ${data.kcalDelta} kcal: compénsalo de forma suave repartida entre los días siguientes (nunca todo en un día, nunca con platos de castigo).`
        : `Hoy hay un DÉFICIT extra estimado de ${Math.abs(data.kcalDelta)} kcal (por ejemplo ejercicio): reponlo en los días siguientes con algo más de energía en las comidas, sin pasar hambre.`
      : "Si de lo que cuenta se deduce un exceso o un déficit de energía, compénsalo de forma suave en los días siguientes.";

    const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
    const home = await householdContext(context.supabase as never, context.userId);
    // Un no planificador recoloca sus comidas en solitario; las compartidas
    // las lleva quien planifica en casa (D2). Se lo decimos a la IA en el
    // prompt Y, por si no lo respeta, se congelan mecánicamente después
    // (mismo patrón "cinturón y tirantes" que el resto de REGLAs).
    const isNonPlannerInHousehold = !!home.plannerId && home.plannerId !== context.userId;
    const plannerName =
      home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
    const sharedSlotsLine = isNonPlannerInHousehold
      ? `REGLA 5: Hay comidas compartidas en tu casa que lleva ${plannerName}: ${describeSharedSlots(home.sharedSlots)}. NO las toques — devuélvelas exactamente igual que en el plan actual. Ajusta solo tus comidas en solitario.\n`
      : "";

    const plan = await askForJson(
      {
        key,
        system: coachSystemPrompt(profile as never, home.text),
        prompt:
          `Plan actual del mes ${data.month}:\n${JSON.stringify(current)}\n\n` +
          `Ingredientes ya comprados (no pueden cambiar): ${ingredientNames(shopping)}\n\n` +
          (pantryExtras.length
            ? `Además la persona dice tener ya en casa (fuera de la lista de la compra, puedes usarlos en los platos): ${pantryExtras.map((e) => e.name).join(", ")}\n\n`
            : "") +
          `${goalLine}\n` +
          `Últimos días reales registrados: ${JSON.stringify(logs ?? [])}\n\n` +
          `Hoy es ${data.today} (${cursor.dayName}, semana ${cursor.weekIndex + 1} del plan).\n` +
          `Lo que ha pasado / lo que cuenta la persona: ${data.note}\n\n` +
          `REGLA 1: el día de hoy y los días anteriores YA ESTÁN FIJADOS: devuélvelos exactamente igual. Cambia sólo los días POSTERIORES a hoy.\n` +
          `REGLA 2: usa SOLO los ingredientes ya comprados y los que la persona dice tener en casa (más sal, aceite, agua y especias). No cambies la lista de la compra ni añadas alimentos nuevos que no estén en ninguna de esas dos listas.\n` +
          `REGLA 3: ${kcalLine}\n` +
          "REGLA 4: mantén el rumbo del objetivo con ajustes realistas (más verdura y proteína, raciones algo menores o mayores, cenas más ligeras o más completas). Tono comprensivo, sin culpar ni compensar en exceso. " +
          `${sharedSlotsLine}` +
          "Actualiza 'intro' con 1-2 frases explicando en lenguaje sencillo qué has recolocado y por qué. " +
          'Devuelve solo JSON válido con la misma forma: {"intro": string, "focus": [3 strings], "weeks": [{"label", "focus", "breakfasts": [..], "snacks": [..], "days": [{"day","lunch","dinner"}]}]}. Sin markdown.',
      },
      (parsed) => completePlan(cleanPlan(parsed)),
    );

    const merged = mergeFuturePlan(current, plan, cursor);
    // Cinturón: si la IA tocó igualmente un día compartido, se restaura desde
    // `current` (congelado) — un no planificador nunca puede acabar
    // escribiendo, ni por accidente, el plato de una comida de la casa.
    const final = isNonPlannerInHousehold
      ? (composeMonthlyPlanForMember(merged, current, home.sharedSlots) ?? merged)
      : merged;

    const { error } = await context.supabase
      .from("monthly_plans")
      .update({ plan: final as never } as never)
      .eq("month", data.month)
      .eq("user_id", context.userId);
    if (error) throw error;

    const { synced } = await syncSharedMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      month: data.month,
      today: data.today,
    });

    const summary = isNonPlannerInHousehold
      ? `${final.intro} Las comidas compartidas de tu hogar no las toco — esas las lleva ${plannerName}.`
      : synced
        ? `${final.intro} También he ajustado las comidas compartidas de tu hogar.`
        : final.intro;

    return { plan: final, summary };
  });

/**
 * Ingredientes que pide un plato y no están en la lista de la compra. Se
 * resuelve con el modelo porque casar texto libre con la lista no funciona a
 * ojo ("pechuga de pollo" está cubierto por "pollo", "tomates cherry" por
 * "tomate"). Si la comprobación falla no se marca nada: preferimos no avisar
 * antes que avisar en falso de algo que la persona sí tiene en casa.
 */
async function offShoppingList(
  dish: string,
  shopping: ShoppingList,
  pantryExtras: PantryExtra[] = [],
): Promise<string[]> {
  const bought = ingredientNames(shopping);
  const extra = pantryExtras.map((e) => e.name).join(", ");
  const names = [bought, extra].filter(Boolean).join(", ");
  const key = process.env.OPENROUTER_API_KEY;
  if (!names || !key) return [];

  try {
    const ai = createAiProvider(key);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      temperature: 0,
      prompt:
        `Ingredientes disponibles (comprados y los que dice tener en casa): ${names}\n` +
        `Plato: "${dish}"\n\n` +
        "¿Qué ingredientes necesarios para ese plato NO están disponibles? " +
        "Da por disponibles la sal, el aceite, el vinagre, el agua y las especias básicas. " +
        "Cuenta como cubierto todo ingrediente equivalente aunque el nombre no sea idéntico " +
        "(p. ej. 'pechuga de pollo' lo cubre 'pollo'; 'tomate cherry' lo cubre 'tomate'). " +
        'Devuelve solo JSON: {"fuera": [ingredientes que faltan, en minúsculas, máx. 5; lista vacía si no falta ninguno]}',
    });
    const parsed = (parseJsonLoose(text) ?? {}) as { fuera?: unknown };
    return (Array.isArray(parsed.fuera) ? parsed.fuera : [])
      .map((n) => String(n).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
  } catch (error) {
    console.error("offShoppingList", error);
    return [];
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
  .validator((input: { date: string; slot: string; dish: string; today?: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? ""))
      throw new ValidationError("Fecha no válida");
    if (!MEAL_SLOTS.includes(input?.slot as MealSlot))
      throw new ValidationError("Comida no válida");
    const dish = String(input?.dish ?? "")
      .trim()
      .slice(0, 200);
    if (!dish) throw new ValidationError("Falta el plato nuevo");
    const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
    if (input.date < today) {
      throw new ValidationError(
        "Los días pasados ya están cerrados: solo puedo cambiar de hoy en adelante",
      );
    }
    return { date: input.date, slot: input.slot as MealSlot, dish, today };
  })
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

      // Plato resuelto tal cual se veía en pantalla antes de este cambio (con
      // la rotación semanal ya aplicada para desayuno/snack si no había un
      // plato pedido a mano ese día), para que el caller pueda guardarlo como
      // "lo que había antes" — ver `wasIdea` en daily.ts.
      const previousIdea =
        mealsForDate(current, data.date).find((m) => m.slot === data.slot)?.idea ?? "";

      const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
      const pantryExtras = cleanPantryExtras(
        (row as { pantry_extras?: unknown } | null)?.pantry_extras,
      );
      const off = await offShoppingList(data.dish, shopping, pantryExtras);
      const field = MEAL_SLOT_FIELD[data.slot];

      const next: MonthlyPlan = {
        ...current,
        weeks: current.weeks.map((week, wi) =>
          wi !== at.weekIndex
            ? week
            : {
                ...week,
                days: week.days.map((day, di) => {
                  if (di !== at.dayIndex) return day;
                  const extras = { ...(day.extras ?? {}) };
                  if (off.length) extras[data.slot] = off;
                  else delete extras[data.slot];
                  const updated: PlanDay = { ...day, [field]: data.dish };
                  if (Object.keys(extras).length) updated.extras = extras;
                  else delete updated.extras;
                  return updated;
                }),
              },
        ),
      };

      const { error } = await context.supabase
        .from("monthly_plans")
        .update({ plan: next as never } as never)
        .eq("month", month)
        .eq("user_id", context.userId);
      if (error) {
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
        dish: data.dish,
        off,
        previousIdea,
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
      const off = data.dish ? await offShoppingList(data.dish, shopping, pantryExtras) : [];

      const next: MonthlyPlan = {
        ...current,
        weeks: current.weeks.map((week, wi) =>
          wi !== at.weekIndex
            ? week
            : {
                ...week,
                days: week.days.map((day, di) => {
                  if (di !== at.dayIndex) return day;
                  const others = (day.kids ?? []).filter(
                    (k) => !(k.childId === child.id && k.slot === data.slot),
                  );
                  const kids: ChildMeal[] = data.dish
                    ? [
                        ...others,
                        {
                          childId: child.id,
                          slot: data.slot,
                          dish: data.dish,
                          ...(off.length ? { off } : {}),
                        },
                      ]
                    : others;
                  const updated: PlanDay = { ...day };
                  if (kids.length) updated.kids = kids;
                  else delete updated.kids;
                  return updated;
                }),
              },
        ),
      };

      const { error } = await context.supabase
        .from("monthly_plans")
        .update({ plan: next as never } as never)
        .eq("month", month)
        .eq("user_id", context.userId);
      if (error) {
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
        dish: data.dish,
        off,
      };
    },
  );

/** Calcula cómo afecta lo ocurrido al objetivo y propone acortar el plazo o ser más laxo. */
export const goalImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { note: string; today?: string }) => ({
    note: String(input?.note ?? "").slice(0, 1500),
    today: /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO(),
  }))
  .handler(
    async ({ data, context }): Promise<{ text: string; suggested_target_date: string | null }> => {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

      const [{ data: profile }, { data: logs }] = await Promise.all([
        context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
        context.supabase
          .from("daily_logs")
          .select("log_date, weight_kg, habits")
          .eq("user_id", context.userId)
          .lte("log_date", data.today)
          .order("log_date", { ascending: false })
          .limit(14),
      ]);

      const result = await askForJson(
        {
          key,
          system: coachSystemPrompt(profile as never),
          prompt:
            `Perfil: ${JSON.stringify(profile ?? {})}\n` +
            `Últimos días registrados: ${JSON.stringify(logs ?? [])}\n` +
            `Hoy es ${data.today}.\n` +
            `Lo que cuenta la persona: ${data.note}\n\n` +
            "Estima en kcal el impacto de lo que cuenta (exceso o déficit) y calcula cómo afecta a su objetivo de peso y a su fecha objetivo (7700 kcal ≈ 1 kg). " +
            "Después ofrécele dos caminos: 1) mantener el ritmo y adelantar la fecha objetivo, o 2) ser algo más laxo y mantener la fecha. Sin culpar, sin dramatizar, con números orientativos y frases cortas. " +
            'Devuelve solo JSON: {"kcal_delta": number (positivo = exceso, negativo = déficit), "text": string (máx. 6 líneas, sin markdown, hablándole de tú y terminando con una pregunta para que elija), "suggested_target_date": string "YYYY-MM-DD" o null (sólo si acortar el plazo es realista)}',
        },
        (parsed) => {
          const o = (parsed ?? {}) as Record<string, unknown>;
          const text = String(o.text ?? "").trim();
          if (!text) return null;
          const date = String(o.suggested_target_date ?? "");
          return {
            text,
            suggested_target_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
          };
        },
      );

      return result;
    },
  );

export const welcomeBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string }) => ({ month: String(input?.month ?? "") }))
  .handler(async ({ data, context }): Promise<{ text: string }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { householdContext } = await import("@/lib/household.server");
    const [{ data: profile }, { data: row }, home] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      ownPlanRow(context.supabase as never, context.userId, data.month, "plan, shopping"),
      householdContext(context.supabase as never, context.userId),
    ]);
    const plan = cleanPlan((row as { plan?: unknown } | null)?.plan);
    const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);

    // Un no planificador del hogar (D1): el plan y la compra de las comidas
    // compartidas los lleva otra persona; él solo planifica sus comidas en
    // solitario. El mensaje de bienvenida tiene que explicar ese reparto en vez
    // de hablar de "tu plan del mes" como si fuera entero suyo.
    const isNonPlanner = !!home.plannerId && home.plannerId !== context.userId;
    const plannerName =
      home.members.find((m) => m.userId === home.plannerId)?.displayName ??
      "otra persona de tu casa";

    const ai = createAiProvider(key);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      system: coachSystemPrompt(profile as never, home.householdId ? home.text : null),
      prompt: isNonPlanner
        ? "Escribe un mensaje de bienvenida corto (máx. 10 líneas, sin markdown) para alguien que acaba de entrar en un hogar compartido y NO es quien planifica. Explícale: " +
          `1) que el menú de las comidas compartidas de tu casa y su lista de la compra los prepara ${plannerName}, y que los ve en la app sin tener que generar nada; ` +
          "2) qué hace él: planifica sus comidas en solitario (las que no comparte) desde la pestaña Plan, registra cada día lo que come en la pestaña Hoy, y en Ingredientes marca lo que ya hay en casa o se ha comprado; " +
          "3) que el botón flotante sirve para hablar conmigo cuando quiera. " +
          "Tono motivador y cercano, sin presiones."
        : `Plan del mes creado: ${plan ? JSON.stringify({ intro: plan.intro, focus: plan.focus, semanas: plan.weeks.map((w) => w.focus) }) : "sin plan"}\n` +
          `Lista de la compra (${shoppingTotal(shopping)} € aprox.): ${ingredientNames(shopping) || "sin lista"}\n\n` +
          "Escribe un mensaje de bienvenida corto (máx. 10 líneas, sin markdown) que: " +
          "1) resuma en 2 frases el enfoque de su plan del mes y su coste aproximado; " +
          "2) explique cómo funciona la app: la pestaña Hoy con su guía, platos y hábitos; la pestaña Plan con el mes y la lista de la compra que confirma cuando ya ha comprado; el botón flotante para hablar conmigo en cualquier momento; " +
          "3) deje claro que si un día se salta el plan solo tiene que contármelo y yo recoloco los días siguientes con lo que ya tiene comprado, sin cambiar la compra y sin juzgarle. " +
          "Tono motivador y comprensivo, sin presiones.",
    });

    return { text: text.trim() };
  });

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
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

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
