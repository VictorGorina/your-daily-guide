import type { ProfilePart } from "@/integrations/supabase/db-client";
import { coachSystemPrompt, currencySymbol, PLAN_MODEL } from "@/lib/ai-provider.server";
import type { Deadline } from "@/lib/deadline";
import {
  describeServings,
  describeSharedSlots,
  MEAL_KEYS as HOUSEHOLD_MEAL_KEYS,
} from "@/lib/household-shared";
// Solo el tipo: se borra en compilación, así que no arrastra `household.server`
// (ni su cliente de servicio) al bundle del navegador. El runtime de este
// contexto se carga siempre con `await import("@/lib/household.server")`.
import type { HouseholdContext } from "@/lib/household.server";
import { logEvent } from "@/lib/log.server";
import { CHEAT_DAY_DISH, concretizePlan } from "@/lib/plan-concrete-dish";
import {
  awayPlanLine,
  cleanPlan,
  cleanShopping,
  completePlan,
  coverageRatio,
  effectiveMealSlots,
  MEAL_SLOT_LABEL,
  MEAL_SLOTS,
  type MonthConstraints,
  type MonthlyPlan,
  PLAN_TARGETS_VERSION,
  type PlanCoverage,
  type ShoppingCadence,
  type ShoppingList,
  tripDayRange,
  tripsForCoverage,
} from "@/lib/plan-shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askForJson, enforceBudget } from "./ai.server";
import { blankSharedSlots, blankUnselectedSlots } from "./rows.server";

/** Lee lo que la persona avisó para un mes antes de generar el plan (§`setMonthConstraints`). */
export async function fetchMonthConstraints(
  supabase: SupabaseClient,
  userId: string,
  month: string,
): Promise<MonthConstraints | null> {
  const { data } = await supabase
    .from("month_constraints")
    .select("away_start, away_end, notes")
    .eq("user_id", userId)
    .eq("month", month)
    .maybeSingle();
  if (!data) return null;
  const row = data as { away_start: string | null; away_end: string | null; notes: string | null };
  return { month, awayStart: row.away_start, awayEnd: row.away_end, notes: row.notes };
}

/**
 * Núcleo de generación de un plan del mes y su lista de la compra: construye el
 * prompt con el perfil y el hogar, se lo pide a la IA, encaja el presupuesto y
 * aplica los "cinturones" de comidas compartidas / slots no elegidos. NO lee ni
 * escribe la base de datos ni consume cuota — de eso se encarga quien lo llama
 * (`generateMonthlyPlan` al crear el mes, `reflowMonthlyPlan` al regenerar por
 * un cambio de mesa). `coverage` lo fija el llamante para que un reflow a media
 * de mes conserve el rango de días original en vez de recortarlo a "de hoy en
 * adelante".
 */
export async function generatePlanBody(opts: {
  key: string;
  userId: string;
  month: string;
  cadence: ShoppingCadence;
  coverage: PlanCoverage;
  home: HouseholdContext;
  profile: ProfilePart | null;
  constraints: MonthConstraints | null;
  /** Objetivo medio de las comidas compartidas del hogar (`householdMealTargets`). */
  sharedTargets?: Awaited<
    ReturnType<(typeof import("@/lib/household.server"))["householdMealTargets"]>
  >;
  /** Presupuesto de la petición (ticket 22, `deadline.ts`). */
  deadline?: Deadline;
}): Promise<{ plan: MonthlyPlan; shopping: ShoppingList }> {
  const { key, userId, month, cadence, coverage, home, profile, constraints } = opts;

  // Objetivo por comida y estructura de la comida (ticket 23): con la ración de
  // AESAN un solo plato no llena una comida. Informativo: las cantidades las
  // pone el código (ración personal, ticket 21).
  const { energyTargets } = await import("@/lib/nutrition/energy");
  const { planTargetsPrompt } = await import("@/lib/nutrition/plan-targets");
  const targetsLine = planTargetsPrompt({
    targets: energyTargets(profile),
    shared: opts.sharedTargets,
  });

  // Qué comidas quiere que se le planifiquen (issue merienda/slots elegidos):
  // único punto de lectura, compartido con `mealsForDate` en la pantalla, así
  // que el generador y lo que se pinta nunca pueden desincronizarse.
  const selectedSlots = effectiveMealSlots(profile ?? {});
  const mealSlotsLine =
    selectedSlots.length < MEAL_SLOTS.length
      ? `COMIDAS A PLANIFICAR: solo ${selectedSlots.map((s) => MEAL_SLOT_LABEL[s].toLowerCase()).join(", ")}. No propongas nada para ${MEAL_SLOTS.filter(
          (s) => !selectedSlots.includes(s),
        )
          .map((s) => MEAL_SLOT_LABEL[s].toLowerCase())
          .join(
            ", ",
          )}: deja esos campos vacíos ("" en "lunch"/"dinner", sin platos de desayuno/merienda) y no incluyas sus ingredientes en la compra. `
      : "";

  const coveredDays = coverage.toDay - coverage.fromDay + 1;
  const ratio = coverageRatio(coverage, month);

  const rawBudget = Number(profile?.budget_month_eur);
  const budget = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : 0;
  // Presupuesto prorrateado a los días que cubre el plan: un plan que empieza a
  // media de mes solo puede gastar la parte proporcional del mes que le queda.
  const proratedBudget = budget > 0 ? Math.round(budget * ratio) : 0;
  // Moneda/país para las referencias de precio (la salida estructurada del
  // plan sigue en español canónico; solo cambian el símbolo y el país).
  const sym = currencySymbol(profile?.currency);
  const country = profile?.country || "ES";
  const marketRef = country === "ES" ? "supermercado en España" : `supermercado de ${country}`;
  const budgetLine =
    proratedBudget > 0
      ? `El coste total de la lista de la compra NO puede superar ${proratedBudget} ${sym} para el periodo que cubre el plan. Ajusta cantidades y elige alimentos económicos hasta encajar en ese presupuesto.`
      : `Ajusta la lista a un presupuesto contenido y realista de ${marketRef}.`;

  const coverageLine =
    coverage.fromDay > 1
      ? `IMPORTANTE: este plan empieza a media de mes. Cubre SOLO del día ${coverage.fromDay} al ${coverage.toDay} de este mes (${coveredDays} días). La lista de la compra y todas las comidas son únicamente para esos días; no planifiques ni compres para días anteriores al ${coverage.fromDay}.`
      : `El plan cubre el mes completo (días 1 al ${coverage.toDay}).`;

  const trips = tripsForCoverage(cadence, coverage);
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
  const isNonPlannerInHousehold = !!home.plannerId && home.plannerId !== userId;
  const plannerName =
    home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
  const myPortion = home.members.find((m) => m.userId === userId)?.portion ?? 1;

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
  const tableKids = home.children.filter((c) => c.stage === "mesa");
  const puréeKids = home.children.filter((c) => c.stage === "triturados");
  const milkKids = home.children.filter((c) => c.stage === "pecho");
  const kidsLine =
    !isNonPlannerInHousehold && home.children.length
      ? [
          tableKids.length
            ? `NIÑOS QUE COMEN DEL PLATO: ${JSON.stringify(
                tableKids.map((c) => ({
                  childId: c.id,
                  nombre: c.name,
                  edad: c.age,
                  alergias: c.allergies || "ninguna",
                  racion: c.portion,
                })),
              )}. Si un plato compartido no le sirve a un niño (lleva su alérgeno, no encaja con su edad, o no se lo va a comer), añade para ESE niño ESE día un plato alternativo sencillo en "days[].kids" — objeto {"childId" (el de la lista), "slot": "desayuno"|"comida"|"cena", "dish": plato corto} — y suma sus ingredientes al "weekQty" a ración de ese niño. Si el plato compartido le vale, no pongas nada: por defecto el niño come lo mismo que la mesa.`
            : "",
          puréeKids.length
            ? `BEBÉS DE TRITURADOS (comen aparte, NO del plato de la mesa): ${JSON.stringify(
                puréeKids.map((c) => ({
                  childId: c.id,
                  nombre: c.name,
                  edad: c.age,
                  alergias: c.allergies || "ninguna",
                  racion: c.portion,
                })),
              )}. Para CADA uno, añade en "days[].kids" su propio plato en comida y cena de cada día: un puré o triturado sencillo, sin sal ni azúcar, adaptado a su edad y sin sus alérgenos. Suma sus ingredientes al "weekQty" a su ración (pequeña). El plato de la mesa NO se dimensiona para ellos.`
            : "",
          milkKids.length
            ? `BEBÉS DE PECHO O BIBERÓN: ${milkKids
                .map((c) => c.name)
                .join(
                  ", ",
                )}. No comen alimentos sólidos: no les pongas plato en "days[].kids" ni sumes nada a la compra por ellos.`
            : "",
        ]
          .filter(Boolean)
          .join(" ")
      : "";

  // Viaje/ausencia avisada antes de generar el plan (ver `setMonthConstraints`):
  // solo cambia las comidas personales de quien la avisó, nunca las
  // compartidas del hogar.
  const awayLine = constraints
    ? awayPlanLine({
        month,
        coverage,
        awayStart: constraints.awayStart,
        awayEnd: constraints.awayEnd,
        notes: constraints.notes,
        sharedSlots: home.sharedSlots,
        mealSlots: selectedSlots,
      })
    : "";

  const { plan: rawPlan, shopping: rawShopping } = await askForJson(
    {
      key,
      userId,
      model: PLAN_MODEL,
      deadline: opts.deadline,
      system: coachSystemPrompt(profile, home.text),
      prompt:
        `Crea el plan del mes ${month} y su lista de la compra. Devuelve solo JSON válido:\n` +
        '{"shopping": [objetos {"category": "Verdura y fruta"|"Proteína"|"Despensa"|"Lácteos"|"Otros", ' +
        '"items": [{"name": string (ingrediente), "unit": "g"|"ml"|"ud" (g para sólidos, ml para líquidos, ud para piezas/manojos/latas), ' +
        '"weekQty": [4 números] (cantidad en "unit" que piden los platos de CADA semana del mes para las raciones del hogar; 0 si esa semana no se usa), ' +
        `"weekPrice": [4 números] (${sym} orientativo de ${marketRef} para la cantidad de cada semana), ` +
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
        `COMER FUERA: cada plato dice QUÉ se come, nunca DÓNDE. Aunque ese día coma fuera de casa, escribe un plato concreto y realista que pueda pedir, elegir o llevarse (p. ej. "Paella de marisco", "Ensalada de pasta con atún en tupper", "Pechuga con arroz"), sin "fuera de casa", "restaurante", "menú del día", "o similar" ni nada abierto. Única excepción: un cheat day puntual, como mucho uno a la semana, escrito exactamente "${CHEAT_DAY_DISH}". No cuentes en la compra los ingredientes de una comida que sabes que hace fuera de casa. ` +
        `${mealSlotsLine}` +
        `${servingsLine}` +
        `${kidsLine}` +
        `${awayLine ? `${awayLine} ` : ""}` +
        `${targetsLine} ` +
        'Los componentes de cada comida (pan, fruta, lácteo del postre) también van en la compra, en su "weekQty". ' +
        "Platos sencillos, repetibles y realistas (puedes repetir platos entre semanas). Frases cortas para que el JSON quepa completo. Sin gramajes rígidos en los platos. Sin markdown ni explicaciones.",
    },
    (parsed) => {
      const p = (parsed ?? {}) as { plan?: unknown; shopping?: unknown };
      const completed = completePlan(cleanPlan(p.plan));
      const shopping = cleanShopping(p.shopping);
      if (!completed || !shopping.length) return null;
      // Red determinista para "Comida fuera de casa: Paella o similar": se
      // arregla aquí y no con un reintento, que rehacía el plan entero (~100 s).
      const { plan, report } = concretizePlan(completed);
      if (report.rewritten || report.replaced || report.unresolved) {
        logEvent("warn", "plan_generic_dish_fixed", { ...report });
      }
      return { plan, shopping };
    },
  );

  // Deja la lista dentro del presupuesto prorrateado y fija la cadencia/cobertura
  // del plan como fuente de verdad para las etiquetas de días y compras.
  const shopping = await enforceBudget(
    key,
    userId,
    coachSystemPrompt(profile, home.text),
    rawShopping,
    proratedBudget,
    sym,
    PLAN_MODEL,
    opts.deadline,
  );
  // Cinturón para el modo "solo mis comidas": si la IA rellenó igualmente
  // una comida compartida, se vacía aquí — la fila de un no planificador
  // nunca guarda el plato de una comida de la casa (lo pone el espejo).
  const sharedBlanked = isNonPlannerInHousehold
    ? blankSharedSlots(rawPlan, home.sharedSlots)
    : rawPlan;
  // Cinturón para las comidas que esta persona no quiere planificar en
  // absoluto (independiente de si comparte mesa o no): `mealSlotsLine` ya
  // se lo pidió a la IA, esto lo garantiza aunque no haya obedecido.
  const planBody = blankUnselectedSlots(sharedBlanked, selectedSlots);
  const plan: MonthlyPlan = {
    ...planBody,
    coverage,
    cadence,
    targetsVersion: PLAN_TARGETS_VERSION,
  };
  return { plan, shopping };
}

/** Solo para `bun run eval:plan-lite` (ticket 23): el mismo generador que producción. */
export const _generatePlanBodyForEval = generatePlanBody;
