import { createServerFn } from "@tanstack/react-start";
import { generateText, streamText } from "ai";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COACH_MODEL, coachSystemPrompt, createAiProvider } from "@/lib/ai-provider.server";
import {
  cadenceOf,
  cleanPlan,
  cleanShopping,
  cleanTripActuals,
  cleanTripConfirmations,
  completePlan,
  coverageRatio,
  daysInMonth,
  ingredientNames,
  mealsForDate,
  mergeFuturePlan,
  monthCoverage,
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
  type MealSlot,
  type MonthlyPlan,
  type PlanDay,
  type ShoppingList,
  type TripActuals,
  type TripConfirmations,
} from "@/lib/plan-shared";
import { madridTodayISO } from "@/lib/madrid-date";

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

/**
 * Garantiza que la lista no supere el presupuesto. Primero pide al modelo que la
 * recorte con números concretos; si aun así se pasa, escala los precios de forma
 * proporcional como último recurso para que el total mostrado nunca exceda el
 * tope. Es best-effort: si el recorte por IA falla, no rompe la generación.
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
        `Recórtala hasta NO superar ${target} €: baja cantidades y precios, elige alternativas más baratas y quita lo prescindible, manteniendo una compra equilibrada. ` +
        "Conserva EXACTAMENTE la misma estructura (mismas claves category/items/name/qty/price_eur/trip/perishable) y no cambies el valor de 'trip' de cada ítem. " +
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
    const factor = target / total;
    result = result.map((g) => ({
      ...g,
      items: g.items.map((i) => ({
        ...i,
        price_eur: Math.round(i.price_eur * factor * 100) / 100,
      })),
    }));
  }
  return result;
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

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();

    const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
    const home = await householdContext(context.supabase as never, context.userId);

    const today = madridTodayISO();
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
      return `trip ${t} = días ${from}-${to}`;
    });
    const cadenceLine =
      trips === 1
        ? `La compra es MENSUAL: una sola compra al principio (trip siempre 0, ${tripRanges[0]}). Por frescura, prioriza alimentos que aguanten (congelados, conservas, legumbre seca, huevos, tubérculos, fruta y verdura resistente) y reserva la verdura y el pescado muy perecederos para los primeros días.`
        : `La compra se divide en ${trips} compras: ${tripRanges.join(", ")}. Cada compra lleva los frescos de sus días (verdura de hoja, pescado, carne fresca, fruta madura, lácteos abiertos) y la despensa y congelados van sobre todo en la primera. Reparte los perecederos entre compras para que no se echen a perder.`;

    const { plan: rawPlan, shopping: rawShopping } = await askForJson(
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
          `${coverageLine} ` +
          `${budgetLine} ` +
          `${cadenceLine} ` +
          "FRESCURA: cada ingrediente debe consumirse en los días que cubre su compra; no planifiques platos con alimentos frescos comprados muchos días antes. Marca perishable=true en frescos (verdura de hoja, pescado, carne fresca, fruta blanda, lácteos frescos) y false en despensa, congelados y conservas. " +
          (trips > 1
            ? "REPETICIÓN ENTRE COMPRAS: puedes repetir un plato en varias semanas, pero si eso hace que un ingrediente perecedero haga falta en más de una compra, NO lo pongas todo en una sola fila — inclúyelo una vez por cada compra en la que se necesita (mismo name, distinto trip), cada fila solo con la cantidad y el precio de esa compra (no la suma de todas), para que cada semana compre sus propios frescos en vez de acumularlos en la primera. La despensa/congelados/conservas sí van en una sola fila en la compra 0, sin repetir. "
            : "") +
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

    // Deja la lista dentro del presupuesto prorrateado y fija la cadencia/cobertura
    // del plan como fuente de verdad para las etiquetas de días y compras.
    const shopping = await enforceBudget(
      key,
      coachSystemPrompt(profile as never, home.text),
      rawShopping,
      proratedBudget,
    );
    const plan: MonthlyPlan = { ...rawPlan, coverage, cadence: data.cadence };

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
      plan,
      shopping,
    });

    return { plan, shopping };
  });

/**
 * Reasigna el campo 'trip' de cada ingrediente a la compra que de verdad lo
 * necesita, viendo los platos reales de los días de cada tramo bajo la nueva
 * cadencia — a diferencia del reparto ciego de `repartitionTrips`
 * (round-robin sin mirar qué días usan cada ingrediente), que aquí solo actúa
 * como red de seguridad si la IA falla. Con una sola compra (mensual) no hace
 * falta preguntarle a nadie: todo va al tramo 0.
 */
async function reassignTripsByDishes(
  key: string,
  system: string,
  plan: MonthlyPlan,
  shopping: ShoppingList,
  cadence: ShoppingCadence,
  month: string,
): Promise<ShoppingList> {
  const trips = tripsOfCadence(cadence);
  if (trips === 1) return repartitionTrips(shopping, cadence);

  // Mismo rango de días por tramo que ve la persona en pantalla (tripLabel/
  // tripTiming): NO el índice crudo de `plan.weeks`, que siempre empieza en
  // "Semana 1 = días 1-7" aunque el plan arranque a media de mes — usar ese
  // índice directamente desalinea qué platos caen en cada compra.
  const coverage = plan.coverage ?? { fromDay: 1, toDay: daysInMonth(month) };
  const tripBlocks = Array.from({ length: trips }, (_, t) => {
    const { from, to } = tripDayRange(coverage, trips, t);
    const lines: string[] = [];
    for (let day = from; day <= to; day++) {
      const date = `${month}-${String(day).padStart(2, "0")}`;
      const d = planForDate(plan, date)?.day;
      if (!d || (!d.lunch && !d.dinner)) continue;
      lines.push(
        `Día ${day}: comida ${d.lunch || "—"}; cena ${d.dinner || "—"}` +
          (d.breakfast ? `; desayuno ${d.breakfast}` : "") +
          (d.snack ? `; snack ${d.snack}` : ""),
      );
    }
    return `Compra ${t} (días ${from}-${to}):\n${lines.length ? lines.join("\n") : "(sin platos con ingredientes frescos propios)"}`;
  });

  const originalTotal = shoppingTotal(shopping);

  try {
    const ai = createAiProvider(key);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      system,
      temperature: 0.2,
      prompt:
        `Lista de la compra actual (JSON, ignora su 'trip' actual): ${JSON.stringify(shopping)}\n\n` +
        `Estos son los platos de cada compra bajo la nueva frecuencia:\n\n${tripBlocks.join("\n\n")}\n\n` +
        `Para cada ingrediente, decide en qué compra(s) hace falta según qué platos lo usan (0..${trips - 1}). ` +
        "Si solo hace falta en una, ponle ese 'trip' sin más. " +
        "Si un plato se repite en varias compras (es habitual, no pasa nada) y por eso el mismo ingrediente perecedero hace falta en más de una, NO lo dejes en una sola fila: duplica esa fila una vez por cada compra en la que se necesita (mismo name/category/perishable, distinto trip), y reparte entre esas copias la cantidad ('qty') y el precio ('price_eur') de forma proporcional a cuántas veces se usa en cada una — la SUMA de 'price_eur' de todas las copias de un mismo ingrediente debe seguir siendo igual a su precio original (no dupliques el gasto). Así cada compra se lleva solo lo suyo, no el mes entero. " +
        "En la compra 0 deja sin duplicar lo que de verdad es despensa (conservas, legumbre seca, congelados, especias, aceite): esas filas se quedan enteras ahí. " +
        "No cambies name/category/perishable de ningún ingrediente ni inventes ingredientes nuevos. " +
        'Devuelve solo JSON: {"shopping": [...]}',
    });
    const parsed = (parseJsonLoose(text) ?? {}) as { shopping?: unknown };
    const cleaned = cleanShopping(parsed.shopping ?? parsed);
    // Red de seguridad: si la IA se fue de precio al repartir (duplicó importes
    // en vez de partirlos, o se dejó ingredientes fuera), el total del mes no
    // puede cambiar — mejor el reparto ciego que un presupuesto que ya no cuadra.
    const driftedTotal = cleaned.length && Math.abs(shoppingTotal(cleaned) - originalTotal) > 0.5;
    if (cleaned.length && !driftedTotal) return cleaned;
  } catch (e) {
    console.error("reassignTripsByDishes", e);
  }
  return repartitionTrips(shopping, cadence);
}

/**
 * Cambia la cadencia de compra (semanal/bisemanal/mensual): reparte los
 * mismos ingredientes entre más o menos compras según los platos reales de
 * cada semana (`reassignTripsByDishes`), así el tramo mostrado encaja con lo
 * que se cocina esos días. No regenera el plan ni sus platos.
 */
export const recadenceMonthlyPlan = createServerFn({ method: "POST" })
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

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("*")
      .eq("id", context.userId)
      .maybeSingle();
    const { data: row } = await context.supabase
      .from("monthly_plans")
      .select("plan, shopping")
      .eq("month", data.month)
      .maybeSingle();
    const typed = row as { plan?: unknown; shopping?: unknown } | null;

    const current = cleanPlan(typed?.plan);
    if (!current) throw new Error("Todavía no hay plan de este mes");
    const shopping = await reassignTripsByDishes(
      key,
      coachSystemPrompt(profile as never, null),
      current,
      cleanShopping(typed?.shopping),
      data.cadence,
      data.month,
    );
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
 * la lista de la compra en sí (los ítems y su precio siguen igual), solo anota
 * de dónde ha salido cada uno. Ir marcando ingrediente a ingrediente es lo que
 * antes hacía de golpe el botón "Ya he comprado esto": no hace falta un paso
 * de confirmación aparte. El emparejamiento es por nombre Y compra (`trip`),
 * no solo por nombre: un mismo ingrediente puede aparecer repartido en varias
 * compras (una fila por semana en la que hace falta, cada una con su cantidad),
 * y marcar la fila de una no debe marcar también la de las demás.
 */
export const toggleShoppingOwned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      month: string;
      itemName: string;
      trip: number;
      source: "fridge" | "store" | null;
    }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new Error("Mes no válido");
      const itemName = String(input?.itemName ?? "").trim();
      if (!itemName) throw new Error("Falta el ingrediente");
      const trip = Number(input?.trip);
      if (!Number.isFinite(trip) || trip < 0) throw new Error("Viaje no válido");
      const source = input?.source === "fridge" || input?.source === "store" ? input.source : null;
      return { month: input.month, itemName, trip: Math.round(trip), source };
    },
  )
  .handler(async ({ data, context }): Promise<{ shopping: ShoppingList }> => {
    const { data: row } = await context.supabase
      .from("monthly_plans")
      .select("shopping")
      .eq("month", data.month)
      .maybeSingle();
    const current = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
    if (!current.length) throw new Error("Todavía no hay lista de la compra este mes");

    const shopping: ShoppingList = current.map((group) => ({
      category: group.category,
      items: group.items.map((item) => {
        if (item.name !== data.itemName || item.trip !== data.trip) return item;
        if (!data.source) {
          const { owned: _owned, ...rest } = item;
          return rest;
        }
        return { ...item, owned: data.source };
      }),
    }));

    const { error } = await context.supabase
      .from("monthly_plans")
      .update({ shopping: shopping as never } as never)
      .eq("month", data.month)
      .eq("user_id", context.userId);
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
  .inputValidator((input: { month: string; trip: number; amount: number | null }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new Error("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new Error("Viaje no válido");
    const amount = input?.amount == null ? null : Number(input.amount);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      throw new Error("Importe no válido");
    }
    return { month: input.month, trip: Math.round(trip), amount };
  })
  .handler(async ({ data, context }): Promise<{ trip_actuals: TripActuals }> => {
    const { data: row } = await context.supabase
      .from("monthly_plans")
      .select("trip_actuals")
      .eq("month", data.month)
      .maybeSingle();
    const current = cleanTripActuals((row as { trip_actuals?: unknown } | null)?.trip_actuals);
    const next = { ...current };
    if (data.amount == null) delete next[data.trip];
    else next[data.trip] = data.amount;

    const { error } = await context.supabase
      .from("monthly_plans")
      .update({ trip_actuals: next as never } as never)
      .eq("month", data.month)
      .eq("user_id", context.userId);
    if (error) {
      console.error("setTripActual", error);
      throw new Error("No hemos podido guardar el gasto");
    }

    return { trip_actuals: next };
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
  .inputValidator((input: { month: string; trip: number; confirmed: boolean }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new Error("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new Error("Viaje no válido");
    return { month: input.month, trip: Math.round(trip), confirmed: Boolean(input?.confirmed) };
  })
  .handler(async ({ data, context }): Promise<{ confirmed_trips: TripConfirmations }> => {
    const { data: row } = await context.supabase
      .from("monthly_plans")
      .select("plan, shopping, confirmed_trips")
      .eq("month", data.month)
      .maybeSingle();
    const typed = row as { plan?: unknown; shopping?: unknown; confirmed_trips?: unknown } | null;
    const shopping = cleanShopping(typed?.shopping);
    if (!shopping.length) throw new Error("Todavía no hay lista de la compra este mes");

    const current = cleanTripConfirmations(typed?.confirmed_trips);
    const next = { ...current };
    if (data.confirmed) next[data.trip] = madridTodayISO();
    else delete next[data.trip];

    // El número "oficial" de tramos es el de la cadencia guardada, no el que se
    // deduzca de los datos (un tramo sin artículos asignados no debe contar de
    // menos y dar por fijado el mes entero antes de tiempo).
    const cadence = cleanPlan(typed?.plan)?.cadence ?? cadenceOf(shopping);
    const allConfirmed = Object.keys(next).length >= tripsOfCadence(cadence);

    const { error } = await context.supabase
      .from("monthly_plans")
      .update({
        confirmed_trips: next as never,
        confirmed_at: allConfirmed ? new Date().toISOString() : null,
      } as never)
      .eq("month", data.month)
      .eq("user_id", context.userId);
    if (error) {
      console.error("setTripConfirmed", error);
      throw new Error("No hemos podido fijar los ingredientes");
    }

    return { confirmed_trips: next };
  });

export const adjustMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { month: string; note: string; today?: string; kcalDelta?: number | null }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new Error("Mes no válido");
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "")
        ? input.today!
        : madridTodayISO();
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
    }): Promise<{
      plan: MonthlyPlan;
      label: string;
      dish: string;
      off: string[];
      previousIdea: string;
    }> => {
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

      // Plato resuelto tal cual se veía en pantalla antes de este cambio (con
      // la rotación semanal ya aplicada para desayuno/snack si no había un
      // plato pedido a mano ese día), para que el caller pueda guardarlo como
      // "lo que había antes" — ver `wasIdea` en daily.ts.
      const previousIdea =
        mealsForDate(current, data.date).find((m) => m.slot === data.slot)?.idea ?? "";

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

      return {
        plan: next,
        label: MEAL_SLOT_LABEL[data.slot],
        dish: data.dish,
        off,
        previousIdea,
      };
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

export type DishRecipe = { ingredients: string[]; steps: string[] };

/**
 * Receta simplificada de un plato, a demanda: se pide solo cuando la persona
 * expande un plato del plan, para no inflar el JSON del plan ni encarecer cada
 * regeneración. Se apoya en los ingredientes ya comprados del mes si los hay.
 */
export const dishRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dish: string; month?: string }) => {
    const dish = String(input?.dish ?? "")
      .trim()
      .slice(0, 200);
    if (!dish) throw new Error("Falta el plato");
    const month = /^\d{4}-\d{2}$/.test(input?.month ?? "") ? input!.month! : "";
    return { dish, month };
  })
  .handler(async ({ data, context }): Promise<DishRecipe> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    let pantry = "";
    if (data.month) {
      const { data: row } = await context.supabase
        .from("monthly_plans")
        .select("shopping")
        .eq("month", data.month)
        .maybeSingle();
      pantry = ingredientNames(cleanShopping((row as { shopping?: unknown } | null)?.shopping));
    }

    return askForJson(
      {
        key,
        system:
          "Eres un cocinero que explica recetas caseras muy simples, en español, con frases cortas y claras.",
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
