import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COACH_MODEL,
  coachSystemPrompt,
  createAiProvider,
  currencySymbol,
  PLAN_MODEL,
} from "@/lib/ai-provider.server";
import { assertCleanFood, BLOCKED_FOOD_MESSAGE, VAGUE_DISH_MESSAGE } from "@/lib/content-guard";
import { deriveGoalType, normalizeGoalType } from "@/lib/daily";
import { absorbedKcal, absorbsTooLittle } from "@/lib/day-balance";
import { type Deadline, requestDeadline } from "@/lib/deadline";
import {
  describeServings,
  describeSharedSlots,
  EMPTY_SCHEDULE,
  MEAL_KEYS as HOUSEHOLD_MEAL_KEYS,
  type MealKey,
} from "@/lib/household-shared";
// Solo el tipo: se borra en compilación, así que no arrastra `household.server`
// (ni su cliente de servicio) al bundle del navegador. El runtime de este
// contexto se carga siempre con `await import("@/lib/household.server")`.
import type { HouseholdContext } from "@/lib/household.server";
import { logEvent } from "@/lib/log.server";
import { showsNutritionNumbers } from "@/lib/macros";
import { cleanIntakeText, type IntakeAnswers, monthIntakeNotes } from "@/lib/month-intake";
import { compensationNeed } from "@/lib/nutrition/compensation";
import type { Misfit, WeeklyIdea } from "@/lib/nutrition/plan-fit";
import type { RotationMisfit } from "@/lib/nutrition/plan-fit.server";
import { PLAN_STRUCTURE_REMINDER } from "@/lib/nutrition/plan-targets";
import { CHEAT_DAY_DISH, concretizePlan } from "@/lib/plan-concrete-dish";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  addKcalAdjust,
  applyPlanChanges,
  applyPlanFitChanges,
  awayPlanLine,
  cadenceOf,
  childPureeGaps,
  cleanPantryExtras,
  cleanPlan,
  cleanReflowChanges,
  cleanShopping,
  compensationWindow,
  completePlan,
  composeMonthlyPlanForMember,
  coverageRatio,
  dateOfPlanCell,
  diffFutureMeals,
  effectiveMealSlots,
  ingredientNames,
  isNextMonthUnlocked,
  isPinned,
  type KcalAdjustCell,
  MEAL_SLOT_LABEL,
  MEAL_SLOTS,
  type MealChange,
  mealsForDate,
  type MealSlot,
  mergeRegeneratedPlan,
  type MonthConstraints,
  monthCoverage,
  type MonthlyPlan,
  monthTitle,
  nextMonthISO,
  normName,
  type PantryExtra,
  parseJsonLoose,
  PLAN_TARGETS_VERSION,
  type PlanChange,
  type PlanCoverage,
  planCursor,
  type PlanFitMark,
  planForDate,
  planSlotIndex,
  type ShoppingCadence,
  type ShoppingList,
  shoppingTotal,
  tripDayRange,
  tripsForCoverage,
  weekdayName,
  withChildMeal,
  withPlanMeal,
} from "@/lib/plan-shared";
import { cleanDaySnacks } from "@/lib/snacks";
import { ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { askForJson, enforceBudget } from "./plan/ai.server";
import {
  blankSharedSlots,
  blankUnselectedSlots,
  guardSharedSlotWrite,
  ownPlanRow,
} from "./plan/rows.server";

export type { MonthlyPlan, ShoppingItem, ShoppingList } from "@/lib/plan-shared";
export { toggleShoppingOwnedHandler } from "./shopping/state.server";
export * from "./shopping/state.functions";

/** Lee lo que la persona avisó para un mes antes de generar el plan (§`setMonthConstraints`). */
async function fetchMonthConstraints(
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

/** Un mes se genera una sola vez (`generateMonthlyPlan`). */
function alreadyPlanned(month: string): ValidationError {
  const title = monthTitle(month);
  return new ValidationError(
    `${title.charAt(0).toUpperCase()}${title.slice(1)} ya tiene su plan. Si cambia tu hogar se recalcula solo.`,
  );
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
async function generatePlanBody(opts: {
  key: string;
  userId: string;
  month: string;
  cadence: ShoppingCadence;
  coverage: PlanCoverage;
  home: HouseholdContext;
  profile: unknown;
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
    targets: energyTargets(profile as never),
    shared: opts.sharedTargets,
  });

  // Qué comidas quiere que se le planifiquen (issue merienda/slots elegidos):
  // único punto de lectura, compartido con `mealsForDate` en la pantalla, así
  // que el generador y lo que se pinta nunca pueden desincronizarse.
  const selectedSlots = effectiveMealSlots(
    (profile ?? {}) as { meal_slots?: unknown; meals_to_plan?: string | null },
  );
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

  const rawBudget = Number(
    (profile as { budget_month_eur?: number | null } | null)?.budget_month_eur,
  );
  const budget = Number.isFinite(rawBudget) && rawBudget > 0 ? rawBudget : 0;
  // Presupuesto prorrateado a los días que cubre el plan: un plan que empieza a
  // media de mes solo puede gastar la parte proporcional del mes que le queda.
  const proratedBudget = budget > 0 ? Math.round(budget * ratio) : 0;
  // Moneda/país para las referencias de precio (la salida estructurada del
  // plan sigue en español canónico; solo cambian el símbolo y el país).
  const sym = currencySymbol((profile as { currency?: string | null } | null)?.currency);
  const country = (profile as { country?: string | null } | null)?.country || "ES";
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
      system: coachSystemPrompt(profile as never, home.text),
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
    coachSystemPrompt(profile as never, home.text),
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
  .handler(
    async ({
      data,
      context,
    }): Promise<{ plan: MonthlyPlan; shopping: ShoppingList; firstPlan: boolean }> => {
      const deadline = requestDeadline();
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

      // Un mes se genera UNA vez: rehacerlo a mano no es un camino (gasta IA y
      // pierde los cambios de la persona). Lo que sí cambia el plan después —el
      // hogar, la despensa— lo recoloca `reflowMonthlyPlan` sin pasar por aquí, y
      // lo que la persona tenga que contar del mes se pregunta ANTES de generar
      // (`MonthIntakeChat`). Va antes de la cuota: un rechazo no la gasta.
      const { data: existing } = await ownPlanRow(
        context.supabase as never,
        context.userId,
        data.month,
        "id",
      );
      if (existing) {
        throw alreadyPlanned(data.month);
      }

      // ¿Es el primer plan de la persona? Entonces el cliente pide además la
      // bienvenida del coach (`welcomeBriefing`). Se mira aquí y no por
      // `app_started_on`: quien se da de alta el día 28 puede preparar primero
      // el mes que viene, y un perfil demo trae ese campo en el pasado.
      const { count: earlierPlans } = await context.supabase
        .from("monthly_plans")
        .select("id", { count: "exact", head: true })
        .eq("user_id", context.userId);

      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(context.userId, "plan-generate");

      const [{ data: profile }, constraints] = await Promise.all([
        context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
        fetchMonthConstraints(context.supabase as never, context.userId, data.month),
      ]);

      const { householdContext, householdMealTargets, syncSharedMeals } =
        await import("@/lib/household.server");
      const [home, sharedTargets] = await Promise.all([
        householdContext(context.supabase as never, context.userId),
        householdMealTargets(context.supabase as never, context.userId),
      ]);

      const { plan, shopping } = await generatePlanBody({
        sharedTargets,
        deadline,
        key,
        userId: context.userId,
        month: data.month,
        cadence: data.cadence,
        coverage: monthCoverage(data.month, data.today),
        home,
        profile,
        constraints,
      });

      // `insert`, no `upsert` (ticket 21): la comprobación de arriba va antes de
      // ~100 s de IA, y dos generaciones a la vez (doble toque, web y móvil) la
      // pasaban las dos; la segunda pisaba el plan que la persona ya veía. La
      // restricción única (user_id, month) hace de guarda en la base de datos.
      const { error } = await context.supabase.from("monthly_plans").insert({
        user_id: context.userId,
        month: data.month,
        plan: plan as never,
        shopping: shopping as never,
        confirmed_at: null,
      } as never);
      if ((error as { code?: string } | null)?.code === "23505") {
        throw alreadyPlanned(data.month);
      }
      if (error) {
        console.error("saveMonthlyPlan", error);
        throw new Error("No hemos podido guardar el plan del mes. Inténtalo otra vez.");
      }

      await syncSharedMeals({
        supabase: context.supabase as never,
        userId: context.userId,
        month: data.month,
        today: data.today,
      });

      return { plan, shopping, firstPlan: !earlierPlans };
    },
  );

/**
 * La petición de cambios de la ronda de `planFit` (ticket 10): cada plato que no
 * encaja, con el objetivo de su comida y el motivo en cifras. Misma forma de
 * respuesta que `reflowMeals` (`{"cambios": [...]}` + `cleanReflowChanges`), y
 * solo con los ingredientes de la compra: la lista no cambia al recolocar.
 */
function askPlanFit(opts: {
  key: string;
  userId: string;
  profile: unknown;
  homeText: string;
  shopping: ShoppingList;
  pantry: string[];
  deadline?: Deadline;
}) {
  return async (
    misfits: Misfit[],
    rotations: RotationMisfit[],
  ): Promise<{ changes: PlanChange[]; ideas: WeeklyIdea[] }> => {
    const { cleanWeeklyIdeas, misfitReasonText } = await import("@/lib/nutrition/plan-fit");
    const allowedDates = [...new Set(misfits.map((m) => m.date))];
    const allowedIdeas = new Set(rotations.map((r) => `${r.week}|${r.slot}|${r.option}`));
    const goal = (m: Misfit) =>
      `~${Math.round(m.kcalGoal / 10) * 10} kcal y ${m.proteinGoal} g de proteína`;
    const dishes = misfits.map((m) => ({
      fecha: m.date,
      comida: m.slot,
      plato: m.dish,
      objetivo: goal(m),
      motivo: misfitReasonText(m),
    }));
    const weekly = rotations.map((r) => ({
      semana: r.week + 1,
      comida: r.slot === "snack" ? "merienda" : "desayuno",
      opcion: r.option + 1,
      plato: r.misfit.dish,
      objetivo: goal(r.misfit),
      motivo: misfitReasonText(r.misfit),
    }));
    return askForJson(
      {
        key: opts.key,
        userId: opts.userId,
        model: PLAN_MODEL,
        deadline: opts.deadline,
        system: coachSystemPrompt(opts.profile as never, opts.homeText),
        prompt:
          "El sistema ajusta la cantidad de cada plato al objetivo de su comida, pero solo hasta " +
          "un límite para que siga siendo el mismo plato. Estos platos del plan no llegan a su " +
          "objetivo ni ajustando la cantidad.\n" +
          (dishes.length ? `Platos de comida y cena:\n${JSON.stringify(dishes)}\n` : "") +
          (weekly.length
            ? `Ideas de desayuno y merienda de la semana (cada una se repite varios días):\n${JSON.stringify(weekly)}\n`
            : "") +
          "\nPropón para CADA uno otro que sí pueda llegar: si se queda corto, con más energía " +
          "(legumbre, arroz, pasta, patata o pan, y un postre lácteo o fruta); si se pasa, más " +
          "ligero; si le falta proteína, con una fuente clara (carne, pescado, huevo, legumbre, " +
          "yogur griego o skyr, queso fresco). Un desayuno o una merienda nunca es solo fruta o " +
          `verdura. ${PLAN_STRUCTURE_REMINDER} ` +
          `Usa SOLO estos ingredientes (más sal, aceite, agua y especias): ${ingredientNames(opts.shopping)}` +
          (opts.pantry.length ? `, ${opts.pantry.join(", ")}` : "") +
          ". No repitas el mismo plato en días seguidos. Platos concretos y realistas.\n" +
          'Devuelve solo JSON válido: {"cambios": [{"fecha": "AAAA-MM-DD", "comida": string, "cena": string}], ' +
          '"ideas": [{"semana": número, "comida": "desayuno"|"merienda", "opcion": número, "plato": string}]}, ' +
          'con "comida" o "cena" solo en la que se pide cambiar y la misma "semana" y "opcion" de cada idea. ' +
          "Listas vacías si no hay nada que cambiar. Sin markdown.",
      },
      (parsed) => {
        const o = (parsed ?? {}) as Record<string, unknown>;
        if (!Array.isArray(o.cambios) && !Array.isArray(o.ideas)) return null;
        const changes =
          cleanReflowChanges({ cambios: Array.isArray(o.cambios) ? o.cambios : [] }, allowedDates)
            ?.changes ?? [];
        return { changes, ideas: cleanWeeklyIdeas(o, allowedIdeas) };
      },
    );
  };
}

/** Solo para `bun run eval:plan-lite`: la misma ronda que producción, sin base de datos. */
export async function _fitPlanForEval(opts: {
  key: string;
  plan: MonthlyPlan;
  shopping: ShoppingList;
  month: string;
  profile: unknown;
}) {
  const { fitPlanMeals } = await import("@/lib/nutrition/plan-fit.server");
  return fitPlanMeals({
    plan: opts.plan,
    month: opts.month,
    after: `${opts.month}-00`,
    profile: opts.profile,
    shared: () => ({}),
    canTouchShared: true,
    apiKey: opts.key,
    userId: null,
    ask: askPlanFit({
      key: opts.key,
      userId: "",
      profile: opts.profile,
      homeText: "",
      shopping: opts.shopping,
      pantry: [],
    }),
  });
}

/**
 * Comprueba el plan del mes contra el objetivo y corrige lo que no encaja, en
 * UNA ronda (ticket 10 de `precision-nutricional`, `fitPlanMeals`). La lanza el
 * cliente cuando termina el precalentado de recetas (`recipe-warm.ts`): con
 * todas en la caché, medir el mes solo lee. Generar ya tarda ~100 s y las
 * recetas del mes no caben además en la misma función.
 *
 * - Como mucho una vez por plan: la marca `plan.fit` se guarda aunque no cambie
 *   nada, y un plan regenerado nace sin ella. Solo planes con `targetsVersion`.
 * - Solo días posteriores a hoy; nunca un plato puesto a mano (`pinned`).
 * - Comidas propias primero (D4); una compartida solo la cambia quien planifica.
 * - La compra no cambia: los platos nuevos usan sus ingredientes.
 *
 * Devuelve lo que cambió para enseñarlo: un cambio automático del plan tiene
 * que verse. Ruta espejo: `POST /api/v1/plan/fit`.
 */
export const fitMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; today?: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
    return { month: input.month, today };
  })
  .handler(async ({ data, context }): Promise<{ fit: PlanFitMark | null }> => {
    const deadline = requestDeadline();
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");
    const supabase = context.supabase as never as SupabaseClient<never, never, never>;

    const { data: row } = await ownPlanRow(
      supabase,
      context.userId,
      data.month,
      "plan, shopping, pantry_extras",
    );
    const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
    if (!current) return { fit: null };
    if (current.fit) return { fit: current.fit };
    // Un mes pasado es un hecho, no un plan. Un plan anterior al objetivo por
    // comida (ticket 23) tampoco se corrige: Hoy ya explica que el que viene
    // cuadrará, y cambiarle media rejilla a mitad de mes no ayuda.
    if (data.month < data.today.slice(0, 7) || !current.targetsVersion) return { fit: null };

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "plan-fit");

    const [{ data: profile }, household, { fitPlanMeals }] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      import("@/lib/household.server"),
      import("@/lib/nutrition/plan-fit.server"),
    ]);
    const [home, shared] = await Promise.all([
      household.householdContext(supabase as never, context.userId),
      household.sharedMealPortionsByDate(supabase as never, context.userId),
    ]);
    const canTouchShared = !home.plannerId || home.plannerId === context.userId;

    const { report } = await fitPlanMeals({
      plan: current,
      month: data.month,
      after: data.today,
      profile,
      shared,
      canTouchShared,
      apiKey: key,
      userId: context.userId,
      deadline,
      ask: askPlanFit({
        key,
        userId: context.userId,
        deadline,
        profile,
        homeText: home.text,
        shopping: cleanShopping((row as { shopping?: unknown } | null)?.shopping),
        pantry: cleanPantryExtras((row as { pantry_extras?: unknown } | null)?.pantry_extras).map(
          (e) => e.name,
        ),
      }),
    });
    const pct = (n: number) => `${Math.round(n * 100)} %`;
    console.info(
      `fitMonthlyPlan ${data.month}: ${pct(report.before)} → ${pct(report.after)} de ` +
        `${report.measuredDays} días; ${report.misfits} a cambiar, ${report.changed.length} ` +
        `cambiados, ${report.discarded} descartados${report.skipped ? ` (${report.skipped})` : ""}` +
        (report.seconds ? ` · ${JSON.stringify(report.seconds)} s` : ""),
    );

    // Se escribe sobre la versión más reciente (ticket 21): la ronda tarda y la
    // persona puede haber cambiado un plato mientras. Solo entra un cambio cuya
    // celda sigue igual, y si alguien escribe entre la lectura y la escritura se
    // vuelve a aplicar sobre lo nuevo.
    // `as`: sin él TypeScript no ve la asignación dentro de `rebuild` y los da por null.
    let fit = null as PlanFitMark | null;
    let existing = null as PlanFitMark | null;
    try {
      await updatePlanRowCas(supabase, context.userId, data.month, "plan", (row) => {
        const latest = cleanPlan(row.plan);
        existing = latest?.fit ?? null;
        if (!latest || latest.fit) return null;
        const { plan: applied, applied: stillThere } = applyPlanFitChanges(
          latest,
          report.changed,
          data.today,
        );
        fit = {
          at: new Date().toISOString(),
          before: report.before,
          after: report.after,
          changed: stillThere,
        };
        return { plan: { ...applied, fit } satisfies MonthlyPlan };
      });
    } catch (error) {
      console.error("fitMonthlyPlan: guardar", error);
      throw new Error("No hemos podido guardar el plan ajustado. Inténtalo otra vez.");
    }
    if (!fit) return { fit: existing };
    if (fit.changed.length && canTouchShared) {
      await household.syncSharedMeals({
        supabase: supabase as never,
        userId: context.userId,
        month: data.month,
        today: data.today,
      });
    }
    return { fit };
  });

/**
 * Recoloca los días FUTUROS del plan del mes con la IA, sin tocar hoy, el pasado
 * ni la lista de la compra. Es el núcleo compartido por `adjustMonthlyPlan` (la
 * persona cuenta algo — "comí de más", "hice deporte") y por el modo "meals" de
 * `reflowMonthlyPlan` (cambió la despensa). No consume cuota: el bucket lo
 * decide quien llama (`plan-adjust` vs `plan-reflow`).
 */
/**
 * A partir de este desvío (en kcal, en valor absoluto) recolocar deja de ser
 * opcional para la IA. Por debajo se compensa "de forma suave", que puede
 * significar no tocar nada — cambiar una fruta por otra no debe reescribir la
 * semana.
 */
const FORCE_ADJUST_KCAL = 200;

export async function reflowMeals(opts: {
  supabase: SupabaseClient<never, never, never>;
  userId: string;
  key: string;
  month: string;
  today: string;
  note: string;
  kcalDelta: number | null;
  /**
   * Fechas en las que se puede recolocar (ver `compensationWindow`). Sin ella,
   * cualquier día futuro del mes.
   */
  window?: readonly string[];
  /**
   * Desvío personal (el picoteo): tampoco quien planifica toca las comidas
   * compartidas, que son de toda la casa. Se corrige en las suyas en solitario.
   */
  soloOnly?: boolean;
  /**
   * Medir cuánto mueven los cambios con sus recetas y, si se quedan cortos,
   * insistir UNA vez con los números (ticket 18). Lo usa `settleDay`.
   */
  measure?: boolean;
  /** Presupuesto de la petición (ticket 22, `deadline.ts`). */
  deadline?: Deadline;
}): Promise<{
  plan: MonthlyPlan;
  before: MonthlyPlan;
  summary: string;
  synced: number;
  /** Lo que compensan de verdad (ver `absorbedKcal`); `null` sin medir. */
  absorbedKcal: number | null;
  /** Se insistió y siguió corto. */
  partial: boolean;
}> {
  const { supabase, userId, key, month, today, note, kcalDelta } = opts;

  const { data: row } = await ownPlanRow(supabase, userId, month, "plan, shopping, pantry_extras");
  const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
  const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
  const pantryExtras = cleanPantryExtras(
    (row as { pantry_extras?: unknown } | null)?.pantry_extras,
  );
  if (!current) throw new ValidationError("Todavía no hay plan de este mes");

  const recentLogsQuery = (columns: string) =>
    supabase
      .from("daily_logs")
      .select(columns)
      .eq("user_id", userId)
      .lte("log_date", today)
      .order("log_date", { ascending: false })
      .limit(7);
  const [{ data: profile }, withSnacks] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    recentLogsQuery("log_date, weight_kg, habits, mood, notes, snacks"),
  ]);
  // Sin la migración `daily_logs_snacks` la columna no existe (42703): se
  // relee sin ella en vez de quedarse sin los últimos días en el prompt.
  const { data: logs } =
    (withSnacks.error as { code?: string } | null)?.code === "42703"
      ? await recentLogsQuery("log_date, weight_kg, habits, mood, notes")
      : withSnacks;
  // El picoteo va resumido: el libro de cuentas y el último ajuste no le
  // aportan nada al modelo y alargarían mucho el prompt.
  const recentLogs = ((logs ?? []) as Record<string, unknown>[]).map(({ snacks, ...log }) => {
    const entries = cleanDaySnacks(snacks)?.entries ?? [];
    return entries.length
      ? { ...log, picoteo: entries.map((e) => `${e.text} (~${e.kcal} kcal)`) }
      : log;
  });

  const p = (profile ?? {}) as Record<string, unknown>;
  const cursor = planCursor(today);
  const goalLine = (() => {
    if (p.target_weight_kg != null) {
      const target = Number(p.target_weight_kg);
      const current = Number(p.current_weight_kg ?? p.start_weight_kg ?? target);
      const diff = Math.abs(current - target);
      const dir = deriveGoalType(current, target);
      const datePart = p.goal_target_date ? `, fecha orientativa ${p.goal_target_date}` : "";
      if (dir === "mantener" || diff < 1)
        return `Peso objetivo: ${target} kg (actual: ${current} kg — en mantenimiento${datePart}). Equilibra, no restrinjas.`;
      const verb = dir === "perder" ? "perder" : "ganar";
      return `Peso objetivo: ${target} kg (actual: ${current} kg, falta: ${diff.toFixed(1)} kg por ${verb}${datePart}). Ritmo saludable: máx ~1 kg/semana de pérdida, ~0.5 kg/semana de ganancia; nunca déficit mayor de 500 kcal/día.`;
    }
    // Fallback legacy
    const gt = p.goal_type ? normalizeGoalType(String(p.goal_type)) : null;
    return gt
      ? `Objetivo: ${gt} ${p.goal_amount ?? ""} kg, fecha objetivo ${String(p.goal_target_date ?? "sin fecha")}, peso actual ${String(p.current_weight_kg ?? "?")} kg, peso inicial ${String(p.start_weight_kg ?? "?")} kg.`
      : "La persona no tiene un objetivo de peso definido: no asumas uno ni recoloques el plan para adelgazar; céntrate en comidas equilibradas y hábitos.";
  })();
  // Por debajo de este desvío, compensar es opcional (cambiar un plátano por
  // una manzana no debe recolocar la semana). Por encima, el prompt lo exige:
  // sin esto el modelo respondía "el plan ya está equilibrado" incluso ante una
  // pizza con cerveza, que es justo lo que la persona nota como incoherente.
  const strongDelta = kcalDelta != null && Math.abs(kcalDelta) >= FORCE_ADJUST_KCAL;
  const kcalLine = kcalDelta
    ? kcalDelta > 0
      ? `Hoy hay un EXCESO estimado de ${kcalDelta} kcal sobre lo que preveía el plan.` +
        (strongDelta
          ? " Es un desvío grande: NO devuelvas el plan igual. Tienes que recolocar al menos DOS días posteriores a hoy para absorberlo (cenas más ligeras, más verdura y proteína, raciones algo menores), repartido y nunca todo en un día ni con platos de castigo."
          : " Compénsalo de forma suave repartida entre los días siguientes (nunca todo en un día, nunca con platos de castigo).")
      : `Hoy hay un DÉFICIT extra estimado de ${Math.abs(kcalDelta)} kcal (por ejemplo ejercicio) sobre lo que preveía el plan.` +
        (strongDelta
          ? " Es un desvío grande: NO devuelvas el plan igual. Tienes que reponerlo en al menos DOS días posteriores a hoy con comidas algo más completas, sin pasar hambre."
          : " Reponlo en los días siguientes con algo más de energía en las comidas, sin pasar hambre.")
    : "Si de lo que cuenta se deduce un exceso o un déficit de energía, compénsalo de forma suave en los días siguientes.";

  const { householdContext, syncSharedMeals } = await import("@/lib/household.server");
  const home = await householdContext(supabase as never, userId);
  // Un no planificador recoloca sus comidas en solitario; las compartidas
  // las lleva quien planifica en casa (D2). Se lo decimos a la IA en el
  // prompt Y, por si no lo respeta, se congelan mecánicamente después
  // (mismo patrón "cinturón y tirantes" que el resto de REGLAs).
  const isNonPlannerInHousehold = !!home.plannerId && home.plannerId !== userId;
  const hasSharedSlots = HOUSEHOLD_MEAL_KEYS.some((m) => home.sharedSlots[m].length);
  // Sin otro adulto en la mesa, "compartido" no protege a nadie más (p. ej.
  // una persona adulta sola con peques a cargo): sus comidas se tratan como
  // propias igualmente, igual que en `compensationWindow`.
  const soloAdultHousehold = home.members.length <= 1;
  // Quien planifica también deja quietas las compartidas si el desvío es solo
  // suyo (`soloOnly`): su picoteo no cambia la cena de toda la casa.
  const freezeShared =
    isNonPlannerInHousehold ||
    (!!opts.soloOnly && !!home.plannerId && hasSharedSlots && !soloAdultHousehold);
  const plannerName =
    home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
  const sharedSlotsLine = isNonPlannerInHousehold
    ? `REGLA 5: Hay comidas compartidas en tu casa que lleva ${plannerName}: ${describeSharedSlots(home.sharedSlots)}. NO las toques — devuélvelas exactamente igual que en el plan actual. Ajusta solo tus comidas en solitario.\n`
    : freezeShared
      ? `REGLA 5: Estas comidas se comparten con el resto de la casa: ${describeSharedSlots(home.sharedSlots)}. Este ajuste es solo de esta persona: NO las toques — devuélvelas exactamente igual que en el plan actual. Ajusta solo sus comidas en solitario.\n`
      : "";

  // Comidas que esta persona quiere planificar (ver generateMonthlyPlan):
  // una recolocación tampoco debe reintroducir un slot que ya excluyó.
  const selectedSlots = effectiveMealSlots(
    p as { meal_slots?: unknown; meals_to_plan?: string | null },
  );
  const mealSlotsLine =
    selectedSlots.length < MEAL_SLOTS.length
      ? `REGLA 6: solo planifica ${selectedSlots.map((s) => MEAL_SLOT_LABEL[s].toLowerCase()).join(", ")}. No propongas nada para ${MEAL_SLOTS.filter(
          (s) => !selectedSlots.includes(s),
        )
          .map((s) => MEAL_SLOT_LABEL[s].toLowerCase())
          .join(", ")}: esos campos se quedan vacíos.\n`
      : "";

  // El plan guardado no tiene fechas: es una rejilla de 4 semanas × Lunes…
  // Domingo, y qué fecha es cada celda lo decide `dateOfPlanCell` (la semana la
  // marca el día del mes, no el orden natural). Sin esa anotación el modelo
  // entendía "posterior a hoy" como "más abajo en la fila", y en un lunes eso
  // son los días 1 al 6 — ya pasados. Recolocaba de verdad, pero siempre en
  // días que no se podían tocar, y el ajuste no aparecía por ningún lado.
  // Las comidas elegidas a mano van como "fijo": el modelo no debe proponer
  // cambiarlas (y si lo hace, `applyPlanChanges` las ignora igualmente).
  const dated = {
    ...current,
    weeks: current.weeks.map((week, wi) => ({
      ...week,
      days: week.days.map(({ pinned, ...d }, di) => ({
        fecha: dateOfPlanCell(month, wi, di),
        ...d,
        ...(pinned?.length ? { fijo: pinned } : {}),
      })),
    })),
  };
  // Fechas que sí se pueden recolocar, dichas de forma explícita: es más difícil
  // de ignorar que una regla en prosa.
  const editableDates = current.weeks
    .flatMap((week, wi) => week.days.map((_, di) => dateOfPlanCell(month, wi, di)))
    .filter((d): d is string => !!d && d > today && (!opts.window || opts.window.includes(d)));

  /**
   * Una pasada de recolocación. `insist` solo lleva texto en el reintento: ver
   * abajo por qué hace falta pedirlo dos veces.
   *
   * Se le pide SOLO la lista de días a cambiar, no el plan entero de vuelta.
   * Pidiendo las cuatro semanas completas para mover dos cenas, el modelo
   * devolvía casi siempre el plan copiado tal cual (y cuando cambiaba algo lo
   * ponía en la fila equivocada): mucho texto de salida por un cambio mínimo.
   * Una lista corta con fechas explícitas es barata de generar, fácil de
   * validar y se aplica de forma determinista aquí, no a base de confiar.
   */
  const askReflow = (insist: string) =>
    askForJson(
      {
        key,
        userId,
        model: PLAN_MODEL,
        deadline: opts.deadline,
        system: coachSystemPrompt(profile as never, home.text),
        prompt:
          insist +
          `Plan actual del mes ${month} (cada día lleva su "fecha" real):\n${JSON.stringify(dated)}\n\n` +
          `Ingredientes ya comprados (no pueden cambiar): ${ingredientNames(shopping)}\n\n` +
          (pantryExtras.length
            ? `Además la persona dice tener ya en casa (fuera de la lista de la compra, puedes usarlos en los platos): ${pantryExtras.map((e) => e.name).join(", ")}\n\n`
            : "") +
          `${goalLine}\n` +
          `Últimos días reales registrados: ${JSON.stringify(recentLogs)}\n\n` +
          `Hoy es ${today} (${cursor.dayName}, semana ${cursor.weekIndex + 1} del plan).\n` +
          `Lo que ha pasado / lo que cuenta la persona: ${note}\n\n` +
          `REGLA 1: las ÚNICAS fechas que puedes cambiar son ${editableDates.join(", ") || "ninguna"}. Hoy y los días anteriores están cerrados. Guíate por la "fecha" de cada día, no por su posición en la semana. Si un día lleva "fijo", esas comidas las eligió la persona a mano: no las cambies (puedes cambiar la otra comida de ese día).\n` +
          `REGLA 2: usa SOLO los ingredientes ya comprados y los que la persona dice tener en casa (más sal, aceite, agua y especias). No cambies la lista de la compra ni añadas alimentos nuevos que no estén en ninguna de esas dos listas.\n` +
          `REGLA 3: ${kcalLine}\n` +
          "REGLA 4: mantén el rumbo del objetivo con ajustes realistas (más verdura y proteína, raciones algo menores o mayores, cenas más ligeras o más completas). Tono comprensivo, sin culpar ni compensar en exceso. " +
          `${PLAN_STRUCTURE_REMINDER} ` +
          `${sharedSlotsLine}` +
          `${mealSlotsLine}` +
          "En 'intro', 1-2 frases en lenguaje sencillo explicando qué has recolocado y por qué. " +
          'Devuelve SOLO los días que cambias, no el plan entero, como JSON válido: {"intro": string, "cambios": [{"fecha": "AAAA-MM-DD", "comida": string, "cena": string}]}. Incluye "comida" o "cena" solo si cambian ese plato. Sin markdown.',
      },
      (parsed) => {
        const clean = cleanReflowChanges(parsed, editableDates);
        const raw = (parsed as { cambios?: unknown } | null)?.cambios;
        if (clean && Array.isArray(raw) && raw.length > clean.changes.length) {
          // Cambios que la IA propuso fuera de las fechas permitidas: se
          // descartan, pero conviene verlo (un "ajuste" que no cambia nada).
          logEvent("warn", "reflow_changes_discarded", {
            proposed: raw.length,
            kept: clean.changes.length,
          });
        }
        return clean;
      },
    );

  let reflow = await askReflow("");
  let absorbed: number | null = null;
  let partial = false;
  /** Lo que mueve cada plato recolocado del reflow elegido (ver `addKcalAdjust`). */
  let movedCells: KcalAdjustCell[] = [];

  /**
   * Ticket 18: cuánto compensan de verdad unos cambios, con las recetas de la
   * caché a la ración del plan (solo se recolocan comidas propias). Hasta que
   * el reajuste sea código (ticket 12), es lo que evita dar por "compensado" un
   * cambio de lentejas por garbanzos que mueve 30 kcal de 400.
   *
   * Devuelve también lo que mueve cada plato: es lo que se guarda en el día como
   * `kcalAdjust`, porque los platos del plan se escalan al objetivo de su comida
   * (`plannedMacros`) y un plato más ligero, escalado, ya no aligera nada.
   */
  const measure = async (
    changes: PlanChange[],
  ): Promise<{ absorbed: number; cells: KcalAdjustCell[] } | null> => {
    const cells = diffFutureMeals(current, applyPlanChanges(current, changes, today), today);
    if (!cells.length) return { absorbed: 0, cells: [] };
    const [{ getRecipes }, { macrosOfRecipe }, { energyTargets }, { portionFactors }] =
      await Promise.all([
        import("@/lib/nutrition/recipes.server"),
        import("@/lib/nutrition/recipe"),
        import("@/lib/nutrition/energy"),
        import("@/lib/nutrition/portion"),
      ]);
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    const factor = portionFactors(energyTargets(profile as never), profile as never).plan;
    const recipes = await getRecipes(
      cells.flatMap((c) => [c.before, c.after]),
      { apiKey: key, userId, deadline: opts.deadline },
    );
    const kcalOf = (dish: string) => {
      const recipe = recipes.get(dish.trim())?.recipe;
      return recipe ? macrosOfRecipe(recipe, factor).kcal : null;
    };
    const total = absorbedKcal(cells, kcalOf);
    if (total == null) return null;
    return {
      absorbed: total,
      cells: cells.map((c) => ({
        date: c.date,
        slot: c.slot,
        kcal: (kcalOf(c.after) ?? 0) - (kcalOf(c.before) ?? 0),
      })),
    };
  };

  if (opts.measure && kcalDelta) {
    const first = await measure(reflow.changes).catch((error) => {
      console.error("reflowMeals: medir", error);
      return null;
    });
    absorbed = first?.absorbed ?? null;
    movedCells = first?.cells ?? [];
    // Corto (o nada): UNA insistencia, con los números. Sustituye a la genérica
    // de "no has cambiado nada".
    if (absorbed != null && strongDelta && absorbsTooLittle(absorbed, kcalDelta)) {
      const sign = Math.sign(kcalDelta);
      const missing = Math.round(Math.abs(kcalDelta) - Math.max(0, absorbed * sign));
      const second = await askReflow(
        `AVISO: tus cambios mueven unas ${Math.max(0, Math.round(absorbed * sign))} de las ` +
          `${Math.abs(kcalDelta)} kcal que hay que ${sign > 0 ? "quitar" : "reponer"}; faltan unas ` +
          `${missing}. ${sign > 0 ? "Cambia platos por otros más ligeros" : "Cambia platos por otros más completos"} ` +
          "en los días permitidos hasta cubrir esa diferencia, repartida en al menos dos días.\n\n",
      );
      const again = second.changes.length ? await measure(second.changes).catch(() => null) : null;
      if (again != null && again.absorbed * sign > absorbed * sign) {
        reflow = second;
        absorbed = again.absorbed;
        movedCells = again.cells;
      }
      partial = absorbsTooLittle(absorbed, kcalDelta);
    }
    // Para comparar después con el reajuste en código (ticket 12).
    console.info("reflowMeals: absorbido", {
      pending: kcalDelta,
      absorbed,
      ratio: absorbed != null ? Math.round((absorbed / kcalDelta) * 100) / 100 : null,
    });
  }

  // Un desvío grande sin ni un cambio es, casi siempre, el modelo escurriendo
  // el bulto. Se le insiste UNA vez: cuesta una llamada extra y solo pasa en el
  // caso que la persona nota como incoherente ("me he comido una pizza y dice
  // que no cambia nada"). Con `measure`, la insistencia de arriba ya lo cubre.
  if (!opts.measure && strongDelta && !reflow.changes.length) {
    console.warn(`reflowMeals: ${kcalDelta} kcal de desvío y ningún cambio; insistiendo`);
    const second = await askReflow(
      "AVISO: en tu respuesta anterior no cambiaste ningún día, y para este desvío eso no vale. Devuelve al menos DOS días con platos distintos.\n\n",
    );
    if (second.changes.length) reflow = second;
    else console.warn("reflowMeals: sigue sin cambiar nada tras insistir");
  }
  // Sin `measure` (el coach, un plato futuro cambiado a mano), si hay desvío que
  // compensar también se guarda lo que mueve cada plato: si no, el escalado al
  // objetivo de la comida lo borraría y el cambio no compensaría nada.
  if (!opts.measure && kcalDelta && reflow.changes.length) {
    const moved = await measure(reflow.changes).catch((error) => {
      console.error("reflowMeals: medir", error);
      return null;
    });
    movedCells = moved?.cells ?? [];
  }
  // Se aplica sobre la versión más reciente de la fila (ticket 21): la IA
  // tarda y entretanto la persona puede fijar un plato a mano, que
  // `applyPlanChanges` respeta. `before` es esa misma versión, para que lo que
  // la tarjeta "Balance de hoy" enseña como movido sea solo lo que movió esto.
  let final = current;
  let before = current;
  await updatePlanRowCas(supabase, userId, month, "plan", (row) => {
    const latest = cleanPlan(row.plan);
    if (!latest) throw new ValidationError("Todavía no hay plan de este mes");
    const merged: MonthlyPlan = {
      ...addKcalAdjust(applyPlanChanges(latest, reflow.changes, today), movedCells, today),
      intro: reflow.intro || latest.intro,
    };
    // Cinturón: si la IA tocó igualmente un día compartido, se restaura desde
    // lo leído — un no planificador nunca puede acabar escribiendo, ni por
    // accidente, el plato de una comida de la casa.
    const sharedComposed = freezeShared
      ? (composeMonthlyPlanForMember(merged, latest, home.sharedSlots) ?? merged)
      : merged;
    // Mismo cinturón que en generateMonthlyPlan: si la IA reintrodujo un slot
    // que la persona no quiere planificar, se vacía aquí también.
    final = blankUnselectedSlots(sharedComposed, selectedSlots);
    before = latest;
    return { plan: final };
  });

  // Quien planifica con las compartidas congeladas (`soloOnly`) no ha cambiado
  // nada de la casa: no hay nada que espejar al resto.
  const { synced } =
    freezeShared && !isNonPlannerInHousehold
      ? { synced: 0 }
      : await syncSharedMeals({ supabase: supabase as never, userId, month, today });

  const summary = isNonPlannerInHousehold
    ? `${final.intro} Las comidas compartidas de tu hogar no las toco — esas las lleva ${plannerName}.`
    : freezeShared
      ? `${final.intro} Las comidas que compartes con tu casa no las toco.`
      : synced
        ? `${final.intro} También he ajustado las comidas compartidas de tu hogar.`
        : final.intro;

  return { plan: final, before, summary, synced, absorbedKcal: absorbed, partial };
}

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
    const deadline = requestDeadline();
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "plan-adjust");

    const { plan, summary } = await reflowMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      key,
      deadline,
      month: data.month,
      today: data.today,
      note: data.note,
      kcalDelta: data.kcalDelta,
    });
    return { plan, summary };
  });

// ---------------------------------------------------------------------------
// Compensación de un cambio de plato de un día FUTURO
// ---------------------------------------------------------------------------

/** `goal` que pide `compensationNeed`, a partir del perfil — mismo criterio que
 * usa el prompt del coach (peso objetivo si existe, si no el legacy `goal_type`). */
function resolveCompensationGoal(profile: Record<string, unknown>) {
  return profile.target_weight_kg != null
    ? deriveGoalType(
        Number(profile.current_weight_kg ?? profile.start_weight_kg ?? profile.target_weight_kg),
        Number(profile.target_weight_kg),
      )
    : profile.goal_type
      ? normalizeGoalType(String(profile.goal_type))
      : null;
}

/**
 * Compensación de un cambio de plato de un día FUTURO (ticket 10 de
 * `hoy-semanas-editables`: el coach cambia un plato que no es el de hoy, p.
 * ej. "el jueves quiero pollo en vez de pechuga"). No pasa por `habits` (eso
 * es solo de la pestaña Hoy, que solo existe para el día de hoy): aquí no
 * hace falta acumular entre llamadas porque el coach manda un cambio a la
 * vez, así que se decide y se aplica en el momento con las macros reales de
 * los dos platos (`decomposeDishes`, la misma descomposición que usa la guía
 * diaria, sin atarla a "hoy"). Sin cifras fiables de alguno de los dos platos
 * no se compensa a ciegas.
 */
export const compensateFutureDishChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      today?: string;
      date?: string;
      label?: string;
      slot?: string;
      dish?: string;
      plannedDish?: string;
    }) => {
      const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
      const date = String(input?.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= today) {
        throw new ValidationError("Fecha no válida: tiene que ser un día futuro");
      }
      const label = String(input?.label ?? "").slice(0, 60);
      const slot = String(input?.slot ?? "").slice(0, 20);
      const dish = String(input?.dish ?? "").slice(0, 200);
      const plannedDish = String(input?.plannedDish ?? "").slice(0, 200);
      if (!label || !dish || !plannedDish || dish === plannedDish) {
        throw new ValidationError("No hay cambio que compensar");
      }
      return { today, date, label, slot, dish, plannedDish };
    },
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      adjusted: boolean;
      reason?: string;
      changes?: MealChange[];
      summary?: string;
      kcalDelta?: number;
    }> => {
      const supabase = context.supabase as never as SupabaseClient<never, never, never>;
      const { userId } = context;
      const { today, date, label, dish, plannedDish } = data;
      const month = today.slice(0, 7);

      const deadline = requestDeadline();
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(userId, "plan-adjust");

      const { data: profileRow } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      const profile = (profileRow ?? {}) as Record<string, unknown>;
      const goal = resolveCompensationGoal(profile);

      // El día entero servido como plan, con un plato y con el otro: cada plato
      // al objetivo de su comida (`plannedMacros`) y el día cerrado
      // (`closeDay`). Lo que el escalado de ese plato no cubre lo absorben las
      // demás comidas propias del mismo día; solo lo que queda fuera del día
      // es desvío que compensar en otros.
      const { getRecipes } = await import("@/lib/nutrition/recipes.server");
      const { serveDay } = await import("@/lib/nutrition/day-close");
      const { plannedServingsFor, readOwnPlan } =
        await import("@/lib/nutrition/planned-serving.server");
      const ownPlan = await readOwnPlan(supabase, userId, date.slice(0, 7)).catch((error) => {
        console.error("compensateFutureDishChange: plan", error);
        return null;
      });
      const others = mealsForDate(
        ownPlan,
        date,
        effectiveMealSlots(profile as { meal_slots?: unknown; meals_to_plan?: string | null }),
      ).filter((m) => m.idea && m.moment !== label);
      const dayMeals = [
        ...others.map((m) => ({ moment: m.moment, idea: m.idea })),
        { moment: label },
      ];
      const [recipes, servings] = await Promise.all([
        getRecipes([plannedDish, dish, ...others.map((m) => m.idea)], {
          apiKey: key,
          userId,
          deadline,
        }),
        plannedServingsFor({ supabase: supabase as never, userId, profile, date }),
      ]);
      const fromRecipe = recipes.get(plannedDish.trim())?.recipe;
      const toRecipe = recipes.get(dish.trim())?.recipe;
      // Solo con las dos cifras calculadas (D13): sin una, no se compensa a ciegas.
      if (!fromRecipe || !toRecipe) return { adjusted: false, reason: "no-macros" };
      const dayWith = (recipe: typeof fromRecipe) =>
        serveDay(
          dayMeals.map((m) => {
            const { serving, goal, shared } = servings.planned(m.moment);
            const own = "idea" in m ? (recipes.get(m.idea.trim())?.recipe ?? null) : recipe;
            return { recipe: own, serving, goal, shared };
          }),
        ).total;
      const from = dayWith(fromRecipe);
      const to = dayWith(toRecipe);

      const decision = compensationNeed({
        deltaKcal: to.kcal - from.kcal,
        deltaProtein: to.protein_g - from.protein_g,
        goal,
        pregnancyStatus: (profile.pregnancy_status as string | null) ?? null,
      });
      if (!decision.compensate) return { adjusted: false, reason: decision.reason };

      const { householdContext } = await import("@/lib/household.server");
      const home = await householdContext(supabase, userId);
      const window = compensationWindow({
        today,
        sharedSlots: home.sharedSlots,
        selectedSlots: effectiveMealSlots(
          profile as { meal_slots?: unknown; meals_to_plan?: string | null },
        ),
        soloAdult: home.members.length <= 1,
      });
      if (window.reason) return { adjusted: false, reason: window.reason };

      const note = `Ha elegido «${dish}» en vez de «${plannedDish}» para ${label.toLowerCase()} del ${weekdayName(date)} ${Number(date.slice(8, 10))}.`;
      const { plan, before, summary } = await reflowMeals({
        supabase,
        userId,
        key,
        deadline,
        month,
        today,
        note,
        kcalDelta: decision.kcalDelta,
        window: window.dates,
        soloOnly: true,
      });
      const futureChanges = diffFutureMeals(before, plan, today);
      if (!futureChanges.length) return { adjusted: false, reason: "no-change" };
      return { adjusted: true, changes: futureChanges, summary, kcalDelta: decision.kcalDelta };
    },
  );

export type ReflowResult = {
  /** Motivo por el que no se hizo nada (no es un error: el cliente no lo enseña). */
  skipped?: "past" | "not-planner" | "no-plan";
  scope?: "meals" | "full";
  plan?: MonthlyPlan;
  shopping?: ShoppingList;
  summary?: string;
};

/**
 * Recálculo automático y silencioso del plan cuando cambia algo que lo invalida
 * (issue 05). Lo dispara el cliente con un debounce tras un cambio de despensa o
 * de mesa — nunca la persona a mano, nunca por tiempo.
 *
 *  - `scope: "meals"` (cambió la despensa extra): recoloca los platos de los días
 *    futuros con `reflowMeals`. La lista de la compra NO se toca (la despensa
 *    extra nunca entra en la lista).
 *  - `scope: "full"` (entró o salió alguien de la mesa, cambió una ración,
 *    alergia o etapa): regenera plan Y cantidades con el hogar nuevo y luego hace
 *    merge — hoy y el pasado se conservan, y las marcas "en casa"/"comprado"
 *    viajan por nombre de ingrediente a la lista nueva.
 *
 * Solo lo ejecuta quien planifica en casa (o quien va en solitario): un no
 * planificador que toca la despensa compartida (issue 06) no dispara la
 * regeneración del plan de otra persona.
 */
export const reflowMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; today?: string; scope?: "meals" | "full" }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const today = /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO();
    const scope: "meals" | "full" = input?.scope === "full" ? "full" : "meals";
    return { month: input.month, today, scope };
  })
  .handler(async ({ data, context }): Promise<ReflowResult> => {
    const deadline = requestDeadline();
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    // Un mes pasado no se recalcula: no se puede cumplir y gastaría tokens.
    if (data.month < data.today.slice(0, 7)) return { skipped: "past" };

    const { householdPlannerId, householdContext } = await import("@/lib/household.server");
    const plannerId = await householdPlannerId(context.supabase as never, context.userId);
    if (plannerId && plannerId !== context.userId) return { skipped: "not-planner" };

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "plan-reflow");

    const { data: row } = await ownPlanRow(
      context.supabase as never,
      context.userId,
      data.month,
      "plan, shopping",
    );
    const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
    if (!current) return { skipped: "no-plan" };

    if (data.scope === "meals") {
      const { plan, summary } = await reflowMeals({
        supabase: context.supabase as never,
        userId: context.userId,
        key,
        deadline,
        month: data.month,
        today: data.today,
        note: "Ha cambiado lo que hay en la despensa de casa: alguien ha añadido o quitado un ingrediente que ya se tiene. Recoloca SOLO los días posteriores a hoy para aprovechar mejor lo que hay en casa y lo ya comprado. La lista de la compra no cambia.",
        kcalDelta: null,
      });
      return { scope: "meals", plan, summary };
    }

    // scope: "full" — cambió la mesa. Regenera plan y cantidades con el hogar
    // nuevo y hace merge conservando hoy/pasado y las marcas de compra.
    const { syncSharedMeals } = await import("@/lib/household.server");
    const [{ data: profile }, home, constraints] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      householdContext(context.supabase as never, context.userId),
      fetchMonthConstraints(context.supabase as never, context.userId, data.month),
    ]);
    const currentShopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
    const cadence: ShoppingCadence = current.cadence ?? cadenceOf(currentShopping);
    const coverage = current.coverage ?? monthCoverage(data.month, data.today);

    const { householdMealTargets } = await import("@/lib/household.server");
    const sharedTargets = await householdMealTargets(context.supabase as never, context.userId);
    const fresh = await generatePlanBody({
      sharedTargets,
      deadline,
      key,
      userId: context.userId,
      month: data.month,
      cadence,
      coverage,
      home,
      profile,
      constraints,
    });

    // Se aplica sobre la versión más reciente de la fila (ticket 21): generar
    // tarda ~100 s y entretanto la persona puede fijar un plato, marcar la
    // compra o cambiar la cadencia.
    const validChildIds = home.children.map((c) => c.id);
    let final = null as { plan: MonthlyPlan; shopping: ShoppingList } | null;
    try {
      await updatePlanRowCas(
        context.supabase as never,
        context.userId,
        data.month,
        "plan, shopping",
        (row) => {
          const latest = cleanPlan(row.plan);
          if (!latest) return null;
          final = mergeRegeneratedPlan(
            { plan: latest, shopping: cleanShopping(row.shopping) },
            fresh,
            data.today,
            validChildIds,
            { coverage, cadence },
          );
          return {
            plan: final.plan,
            shopping: final.shopping,
            // La compra cambió → el mes deja de estar "cerrado del todo".
            // `confirmed_trips` se conserva (los tramos ya hechos siguen
            // marcados); `setTripConfirmed` recalcula el agregado la próxima vez.
            confirmed_at: null,
          };
        },
      );
    } catch (error) {
      console.error("reflowMonthlyPlan", error);
      throw new Error("No hemos podido actualizar el plan con los cambios");
    }
    if (!final) return { skipped: "no-plan" };
    const { plan: finalPlan, shopping: finalShopping } = final;

    const { synced } = await syncSharedMeals({
      supabase: context.supabase as never,
      userId: context.userId,
      month: data.month,
      today: data.today,
    });

    return {
      scope: "full",
      plan: finalPlan,
      shopping: finalShopping,
      summary: synced
        ? `${finalPlan.intro} También he ajustado las comidas compartidas de tu hogar.`
        : finalPlan.intro,
    };
  });

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
  const extra = pantryExtras.map((e) => e.name).join(", ");
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
 * Guarda lo que la persona contó antes de generar el plan de un mes, en la
 * conversación con el coach que va SIEMPRE antes de generar (`MonthIntakeChat`,
 * `month-intake.ts`): si va a estar fuera de casa un tramo (fechas) y las
 * otras cuatro respuestas (eventos, rutina, ingredientes, notas), que se
 * guardan juntas en `notes` con su etiqueta. Como un mes se genera una sola
 * vez, esto es lo que lo personaliza. Dato personal: no se comparte con el resto del hogar
 * (`generatePlanBody` solo lo aplica a las comidas propias de quien lo
 * guardó, nunca a las compartidas).
 */
export const setMonthConstraints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      month: string;
      awayStart?: string | null;
      awayEnd?: string | null;
      notes?: string | null;
      /** Respuestas de la conversación previa al plan (`MonthIntakeChat`). */
      answers?: IntakeAnswers | null;
    }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
      const hasStart = input?.awayStart != null && input.awayStart !== "";
      const hasEnd = input?.awayEnd != null && input.awayEnd !== "";
      if (hasStart !== hasEnd) throw new ValidationError("Rango de fechas no válido");
      if (
        hasStart &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(input.awayStart!) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(input.awayEnd!) ||
          input.awayStart! > input.awayEnd!)
      ) {
        throw new ValidationError("Rango de fechas no válido");
      }
      // Las respuestas se arman aquí (nunca un texto ya compuesto por el
      // cliente): etiqueta por pregunta, chips solo de su lista, cada una
      // limpia para entrar al prompt como dato. `notes` a pelo sigue valiendo
      // para un cliente antiguo.
      const notes = input?.answers
        ? (monthIntakeNotes(input.answers) ?? "")
        : cleanIntakeText(input?.notes);
      return {
        month: input.month,
        awayStart: hasStart ? input.awayStart! : null,
        awayEnd: hasStart ? input.awayEnd! : null,
        notes: notes || null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<MonthConstraints> => {
    const { error } = await context.supabase.from("month_constraints").upsert(
      {
        user_id: context.userId,
        month: data.month,
        away_start: data.awayStart,
        away_end: data.awayEnd,
        notes: data.notes,
      } as never,
      { onConflict: "user_id,month" },
    );
    if (error) {
      console.error("setMonthConstraints", error);
      throw new Error("No hemos podido guardar esto. Inténtalo otra vez.");
    }
    return data;
  });

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
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

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
      const available = [ingredientNames(shopping), pantryExtras.map((e) => e.name).join(", ")]
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

/** Calcula cómo afecta lo ocurrido al objetivo y propone acortar el plazo o ser más laxo. */
export const goalImpact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { note: string; today?: string }) => ({
    note: String(input?.note ?? "").slice(0, 1500),
    today: /^\d{4}-\d{2}-\d{2}$/.test(input?.today ?? "") ? input.today! : zonedTodayISO(),
  }))
  .handler(
    async ({ data, context }): Promise<{ text: string; suggested_target_date: string | null }> => {
      const deadline = requestDeadline();
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(context.userId, "coach-aux");

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
          userId: context.userId,
          deadline,
          system: coachSystemPrompt(profile as never),
          prompt:
            `Perfil: ${JSON.stringify(profile ?? {})}\n` +
            `Últimos días registrados: ${JSON.stringify(logs ?? [])}\n` +
            `Hoy es ${data.today}.\n` +
            `Lo que cuenta la persona: ${data.note}\n\n` +
            "Estima en kcal el impacto de lo que cuenta (exceso o déficit) y calcula cómo afecta a su objetivo de peso y a su fecha objetivo (7700 kcal ≈ 1 kg). " +
            "Después ofrécele dos caminos: 1) mantener el ritmo y adelantar la fecha objetivo, o 2) ser algo más laxo y mantener la fecha. Sin culpar, sin dramatizar, con números orientativos y frases cortas. " +
            // Ticket 01: con "ocultar", el cálculo se hace igual pero el texto
            // que lee la persona no lleva ninguna cifra de energía.
            (showsNutritionNumbers(profile as never)
              ? ""
              : "IMPORTANTE: esta persona NO quiere ver cifras de calorías ni de macros: el campo text no puede llevar ninguna cifra de kcal ni de gramos; habla de fechas y de sensaciones. ") +
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

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "coach-aux");

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

    const ai = createAiProvider(key, context.userId);
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
          `Lista de la compra (${shoppingTotal(shopping)} ${currencySymbol((profile as { currency?: string | null } | null)?.currency)} aprox.): ${ingredientNames(shopping) || "sin lista"}\n\n` +
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
    const deadline = requestDeadline();
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

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
