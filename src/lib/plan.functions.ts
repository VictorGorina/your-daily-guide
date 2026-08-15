import { createServerFn } from "@tanstack/react-start";
import { generateText, streamText } from "ai";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COACH_MODEL, coachSystemPrompt, createAiProvider } from "@/lib/ai-provider.server";
import {
  cleanPlan,
  cleanShopping,
  completePlan,
  ingredientNames,
  mergeFuturePlan,
  tripsOfCadence,
  type ShoppingCadence,
  MEAL_SLOTS,
  MEAL_SLOT_FIELD,
  MEAL_SLOT_LABEL,
  parseJsonLoose,
  planCursor,
  planSlotIndex,
  shoppingTotal,
  type MealSlot,
  type MonthlyPlan,
  type PlanDay,
  type ShoppingList,
} from "@/lib/plan-shared";

export type { MonthlyPlan, ShoppingItem, ShoppingList } from "@/lib/plan-shared";

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

export const generateMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string; cadence?: ShoppingCadence }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new Error("Mes no válido");
    const cadence: ShoppingCadence =
      input?.cadence === "semanal" || input?.cadence === "bisemanal" ? input.cadence : "mensual";
    return { month: input.month, cadence };
  })
  .handler(async ({ data, context }): Promise<{ plan: MonthlyPlan; shopping: ShoppingList }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { data: existing } = await context.supabase
      .from("monthly_plans")
      .select("confirmed_at")
      .eq("month", data.month)
      .maybeSingle();
    if ((existing as { confirmed_at?: string | null } | null)?.confirmed_at) {
      throw new Error("El plan de este mes ya está confirmado: la compra no puede cambiar");
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();

    const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
    const home = await householdContext(context.supabase as never, context.userId);

    const budget = Number(
      (profile as { budget_month_eur?: number | null } | null)?.budget_month_eur,
    );
    const budgetLine =
      Number.isFinite(budget) && budget > 0
        ? `El coste total de la lista de la compra NO puede superar ${budget} € para todo el mes. Ajusta cantidades y elige alimentos económicos hasta encajar en ese presupuesto.`
        : "Ajusta la lista a un presupuesto contenido y realista de supermercado en España.";

    const trips = tripsOfCadence(data.cadence);
    const cadenceLine =
      trips === 1
        ? "La compra es MENSUAL: una sola compra al principio del mes (trip siempre 0). Por frescura, prioriza alimentos que aguanten (congelados, conservas, legumbre seca, huevos, tubérculos, fruta y verdura resistente) y reserva la verdura y el pescado muy perecederos para los primeros días del mes."
        : trips === 2
          ? "La compra es CADA 2 SEMANAS: exactamente 2 compras. trip 0 = días 1-14, trip 1 = días 15-28+. Los alimentos frescos y perecederos deben repartirse entre las dos compras para que no se echen a perder; la despensa y los congelados pueden ir en la primera."
          : "La compra es SEMANAL: exactamente 4 compras. trip 0 = días 1-7, trip 1 = 8-14, trip 2 = 15-21, trip 3 = 22-28+. Cada compra lleva los frescos de esa semana (verdura de hoja, pescado, carne fresca, fruta madura, lácteos abiertos) y la despensa se compra sobre todo en trip 0.";

    const { plan, shopping } = await askForJson(
      {
        key,
        system: coachSystemPrompt(profile as never, home.text),
        prompt:
          `Crea el plan del mes ${data.month} y su lista de la compra. Devuelve solo JSON válido:\n` +
          '{"shopping": [objetos {"category": "Verdura y fruta"|"Proteína"|"Despensa"|"Lácteos"|"Otros", ' +
          '"items": [{"name": string (ingrediente), "qty": string (cantidad, ej. "2 kg"), "price_eur": number (precio orientativo de supermercado en España para esa cantidad), "trip": number (índice de la compra, 0..' +
          String(trips - 1) +
          '), "perishable": boolean (true si es fresco y aguanta pocos días)}]}], ' +
          '"plan": {"intro": string (2 frases motivadoras y comprensivas), "focus": [3 focos del mes, cortos], ' +
          '"weeks": [4 objetos {"label": "Semana 1".."Semana 4", "focus": string corto, "breakfasts": [2 ideas de desayuno], "snacks": [2 ideas de snack], ' +
          '"days": [7 objetos {"day": "Lunes".."Domingo", "lunch": plato, "dinner": plato}]}]}}\n' +
          "REGLA CLAVE: todos los platos, desayunos y snacks del plan deben poder prepararse ÚNICAMENTE con los ingredientes de la lista de la compra (más sal, aceite, agua y especias básicas). No menciones ningún alimento que no esté en la lista. " +
          `${budgetLine} ` +
          `${cadenceLine} ` +
          "FRESCURA: cada ingrediente debe consumirse en los días que cubre su compra; no planifiques platos con alimentos frescos comprados muchos días antes. Marca perishable=true en frescos (verdura de hoja, pescado, carne fresca, fruta blanda, lácteos frescos) y false en despensa, congelados y conservas. " +
          "Ten en cuenta cuándo cocina y come en casa y cuándo come fuera: en las comidas fuera de casa propón una opción de menú o restaurante y no cuentes sus ingredientes en la compra. " +
          "Si convive con más personas o hay niños, las comidas compartidas deben ser platos que sirvan para todos (sin sus alérgenos) y la compra debe cubrir esas raciones extra. " +
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
      today: new Date().toISOString().slice(0, 10),
      plan,
      shopping,
    });

    return { plan, shopping };
  });

export const confirmMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { month: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new Error("Mes no válido");
    return { month: input.month };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("monthly_plans")
      .update({ confirmed_at: new Date().toISOString() } as never)
      .eq("month", data.month)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const adjustMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { month: string; note: string; today?: string; kcalDelta?: number | null }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new Error("Mes no válido");
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "")
        ? input.today!
        : new Date().toISOString().slice(0, 10);
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

    const { data: row } = await context.supabase
      .from("monthly_plans")
      .select("plan, shopping")
      .eq("month", data.month)
      .maybeSingle();
    const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
    const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
    if (!current) throw new Error("Todavía no hay plan de este mes");

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
    const goalLine = `Objetivo: ${String(p.goal_type ?? "sin definir")} ${p.goal_amount ?? ""} kg, fecha objetivo ${String(p.goal_target_date ?? "sin fecha")}, peso actual ${String(p.current_weight_kg ?? "?")} kg, peso inicial ${String(p.start_weight_kg ?? "?")} kg.`;
    const kcalLine = data.kcalDelta
      ? data.kcalDelta > 0
        ? `Hoy hay un EXCESO estimado de ${data.kcalDelta} kcal: compénsalo de forma suave repartida entre los días siguientes (nunca todo en un día, nunca con platos de castigo).`
        : `Hoy hay un DÉFICIT extra estimado de ${Math.abs(data.kcalDelta)} kcal (por ejemplo ejercicio): reponlo en los días siguientes con algo más de energía en las comidas, sin pasar hambre.`
      : "Si de lo que cuenta se deduce un exceso o un déficit de energía, compénsalo de forma suave en los días siguientes.";

    const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
    const home = await householdContext(context.supabase as never, context.userId);

    const plan = await askForJson(
      {
        key,
        system: coachSystemPrompt(profile as never, home.text),
        prompt:
          `Plan actual del mes ${data.month}:\n${JSON.stringify(current)}\n\n` +
          `Ingredientes ya comprados (no pueden cambiar): ${ingredientNames(shopping)}\n\n` +
          `${goalLine}\n` +
          `Últimos días reales registrados: ${JSON.stringify(logs ?? [])}\n\n` +
          `Hoy es ${data.today} (${cursor.dayName}, semana ${cursor.weekIndex + 1} del plan).\n` +
          `Lo que ha pasado / lo que cuenta la persona: ${data.note}\n\n` +
          `REGLA 1: el día de hoy y los días anteriores YA ESTÁN FIJADOS: devuélvelos exactamente igual. Cambia sólo los días POSTERIORES a hoy.\n` +
          `REGLA 2: usa SOLO los ingredientes ya comprados (más sal, aceite, agua y especias). No cambies la lista de la compra ni añadas alimentos nuevos.\n` +
          `REGLA 3: ${kcalLine}\n` +
          "REGLA 4: mantén el rumbo del objetivo con ajustes realistas (más verdura y proteína, raciones algo menores o mayores, cenas más ligeras o más completas). Tono comprensivo, sin culpar ni compensar en exceso. " +
          "Actualiza 'intro' con 1-2 frases explicando en lenguaje sencillo qué has recolocado y por qué. " +
          'Devuelve solo JSON válido con la misma forma: {"intro": string, "focus": [3 strings], "weeks": [{"label", "focus", "breakfasts": [..], "snacks": [..], "days": [{"day","lunch","dinner"}]}]}. Sin markdown.',
      },
      (parsed) => completePlan(cleanPlan(parsed)),
    );

    const merged = mergeFuturePlan(current, plan, cursor);

    const { error } = await context.supabase
      .from("monthly_plans")
      .update({ plan: merged as never } as never)
      .eq("month", data.month)
      .eq("user_id", context.userId);
    if (error) throw error;

    const { synced } = await syncSharedMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      month: data.month,
      today: data.today,
      plan: merged,
      shopping,
    });

    return {
      plan: merged,
      summary: synced
        ? `${merged.intro} También he ajustado las comidas compartidas de tu hogar.`
        : merged.intro,
    };
  });

/**
 * Ingredientes que pide un plato y no están en la lista de la compra. Se
 * resuelve con el modelo porque casar texto libre con la lista no funciona a
 * ojo ("pechuga de pollo" está cubierto por "pollo", "tomates cherry" por
 * "tomate"). Si la comprobación falla no se marca nada: preferimos no avisar
 * antes que avisar en falso de algo que la persona sí tiene en casa.
 */
async function offShoppingList(dish: string, shopping: ShoppingList): Promise<string[]> {
  const names = ingredientNames(shopping);
  const key = process.env.OPENROUTER_API_KEY;
  if (!names || !key) return [];

  try {
    const ai = createAiProvider(key);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      temperature: 0,
      prompt:
        `Lista de la compra ya hecha: ${names}\n` +
        `Plato: "${dish}"\n\n` +
        "¿Qué ingredientes necesarios para ese plato NO están en la lista? " +
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
  .inputValidator((input: { date: string; slot: string; dish: string; today?: string }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? "")) throw new Error("Fecha no válida");
    if (!MEAL_SLOTS.includes(input?.slot as MealSlot)) throw new Error("Comida no válida");
    const dish = String(input?.dish ?? "")
      .trim()
      .slice(0, 200);
    if (!dish) throw new Error("Falta el plato nuevo");
    const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "")
      ? input.today!
      : new Date().toISOString().slice(0, 10);
    if (input.date < today) {
      throw new Error("Los días pasados ya están cerrados: solo puedo cambiar de hoy en adelante");
    }
    return { date: input.date, slot: input.slot as MealSlot, dish, today };
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ plan: MonthlyPlan; label: string; dish: string; off: string[] }> => {
      const month = data.date.slice(0, 7);
      const { data: row } = await context.supabase
        .from("monthly_plans")
        .select("plan, shopping")
        .eq("month", month)
        .maybeSingle();

      const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
      if (!current) throw new Error(`Todavía no hay plan del mes ${month}`);
      const at = planSlotIndex(current, data.date);
      if (!at) throw new Error("Ese día todavía no tiene menú en el plan");

      const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
      const off = await offShoppingList(data.dish, shopping);
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
        plan: next,
        shopping,
      });

      return { plan: next, label: MEAL_SLOT_LABEL[data.slot], dish: data.dish, off };
    },
  );

/** Calcula cómo afecta lo ocurrido al objetivo y propone acortar el plazo o ser más laxo. */
export const goalImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { note: string; today?: string }) => ({
    note: String(input?.note ?? "").slice(0, 1500),
    today: /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "")
      ? input.today!
      : new Date().toISOString().slice(0, 10),
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
  .inputValidator((input: { month: string }) => ({ month: String(input?.month ?? "") }))
  .handler(async ({ data, context }): Promise<{ text: string }> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const [{ data: profile }, { data: row }] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      context.supabase
        .from("monthly_plans")
        .select("plan, shopping")
        .eq("month", data.month)
        .maybeSingle(),
    ]);
    const plan = cleanPlan((row as { plan?: unknown } | null)?.plan);
    const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);

    const ai = createAiProvider(key);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      system: coachSystemPrompt(profile as never),
      prompt:
        `Plan del mes creado: ${plan ? JSON.stringify({ intro: plan.intro, focus: plan.focus, semanas: plan.weeks.map((w) => w.focus) }) : "sin plan"}\n` +
        `Lista de la compra (${shoppingTotal(shopping)} € aprox.): ${ingredientNames(shopping) || "sin lista"}\n\n` +
        "Escribe un mensaje de bienvenida corto (máx. 10 líneas, sin markdown) que: " +
        "1) resuma en 2 frases el enfoque de su plan del mes y su coste aproximado; " +
        "2) explique cómo funciona la app: la pestaña Hoy con su guía, platos y hábitos; la pestaña Plan con el mes y la lista de la compra que confirma cuando ya ha comprado; el botón flotante para hablar conmigo en cualquier momento; " +
        "3) deje claro que si un día se salta el plan solo tiene que contármelo y yo recoloco los días siguientes con lo que ya tiene comprado, sin cambiar la compra y sin juzgarle. " +
        "Tono motivador y comprensivo, sin presiones.",
    });

    return { text: text.trim() };
  });
