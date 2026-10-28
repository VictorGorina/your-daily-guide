import type { DbClient, ProfilePart } from "@/integrations/supabase/db-client";
// Solo el tipo: el módulo se carga con `await import` dentro del trabajo.
import type { HouseholdContext } from "@/lib/household.server";
import { requireAiKey } from "@/lib/ai-provider.server";
import { requestDeadline } from "@/lib/deadline";
import { logEvent } from "@/lib/log.server";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  applyPlanFitChanges,
  cleanPantryExtras,
  cleanPlan,
  cleanShopping,
  effectiveMealSlots,
  type MonthlyPlan,
  type PlanFitMark,
  type ShoppingCheckMark,
  type ShoppingList,
} from "@/lib/plan-shared";
import { UserFacingError } from "@/lib/validation-error";
import { askPlanFit } from "./fit.server";
import { ownPlanRow } from "./rows.server";

/**
 * El trabajo de `fitMonthlyPlan`, fuera del `.handler()` (ticket 40 de la
 * auditoría). `data` llega ya validado; `ctx.userId` es siempre el del JWT.
 *
 * Hace, una vez por plan cada una y con las recetas del mes ya calculadas, las
 * dos comprobaciones que son parte de hacer el plan (no se anuncian):
 *
 * - El ajuste al objetivo (ticket 10, marca `plan.fit`): cambia los platos que
 *   ni ajustando la cantidad dejan el día en su objetivo.
 * - La de la compra (marca `plan.shoppingCheck`, `coverage.server.ts`): que cada
 *   plato se pueda cocinar con la compra de sus días, y cada compra lleve lo de
 *   sus días. Un plan ya ajustado antes de que existiera también la pasa.
 */
export async function runFitMonthlyPlan(
  ctx: { supabase: DbClient; userId: string },
  data: { month: string; today: string },
): Promise<{ fit: PlanFitMark | null; shoppingCheck?: ShoppingCheckMark | null }> {
  const deadline = requestDeadline();
  const key = requireAiKey();
  const supabase = ctx.supabase;

  const { data: row } = await ownPlanRow(
    supabase,
    ctx.userId,
    data.month,
    "plan, shopping, pantry_extras",
  );
  const current = cleanPlan((row as { plan?: unknown } | null)?.plan);
  if (!current) return { fit: null };
  const doFit = !current.fit;
  const doCheck = !current.shoppingCheck;
  if (!doFit && !doCheck) return { fit: current.fit ?? null, shoppingCheck: current.shoppingCheck };
  // Un mes pasado es un hecho, no un plan. Un plan anterior al objetivo por
  // comida (ticket 23) tampoco se corrige: Hoy ya explica que el que viene
  // cuadrará, y cambiarle media rejilla a mitad de mes no ayuda.
  if (data.month < data.today.slice(0, 7) || !current.targetsVersion) {
    return { fit: current.fit ?? null };
  }

  const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
  // Una ronda por plan: como generarlo, solo la mide el tope mensual.
  await enforceUserRateLimit(ctx.userId, "plan-fit", "month");

  const [{ data: profile }, household, { fitPlanMeals }] = await Promise.all([
    ctx.supabase.from("profiles").select("*").eq("id", ctx.userId).maybeSingle(),
    import("@/lib/household.server"),
    import("@/lib/nutrition/plan-fit.server"),
  ]);
  const home = await household.householdContext(supabase, ctx.userId);
  const shared = await household.sharedMealPortionsByDate(supabase, ctx.userId, home);
  const canTouchShared = !home.plannerId || home.plannerId === ctx.userId;
  const shopping = cleanShopping((row as { shopping?: unknown } | null)?.shopping);
  const pantry = cleanPantryExtras((row as { pantry_extras?: unknown } | null)?.pantry_extras).map(
    (e) => e.name,
  );

  let fitted: MonthlyPlan = current;
  let changed: PlanFitMark["changed"] = [];
  let scores = { before: 1, after: 1 };
  if (doFit) {
    const { plan, report } = await fitPlanMeals({
      plan: current,
      month: data.month,
      after: data.today,
      profile,
      shared,
      canTouchShared,
      apiKey: key,
      userId: ctx.userId,
      deadline,
      ask: askPlanFit({
        key,
        userId: ctx.userId,
        deadline,
        profile,
        homeText: home.text,
        shopping,
        pantry,
      }),
    });
    fitted = plan;
    changed = report.changed;
    scores = { before: report.before, after: report.after };
    const pct = (n: number) => `${Math.round(n * 100)} %`;
    console.info(
      `fitMonthlyPlan ${data.month}: ${pct(report.before)} → ${pct(report.after)} de ` +
        `${report.measuredDays} días; ${report.misfits} a cambiar, ${report.changed.length} ` +
        `cambiados, ${report.discarded} descartados${report.skipped ? ` (${report.skipped})` : ""}` +
        (report.seconds ? ` · ${JSON.stringify(report.seconds)} s` : ""),
    );
  }

  // La compra, sobre el plan ya ajustado. Solo quien decide las cantidades (el
  // planificador, o quien va en solitario); si algo falla, se reintenta la
  // próxima vez que se abra Plan (sin marca).
  let check: Awaited<ReturnType<typeof prepareCheck>> | null = null;
  if (doCheck && canTouchShared) {
    try {
      check = await prepareCheck({
        supabase,
        userId: ctx.userId,
        key,
        month: data.month,
        today: data.today,
        plan: fitted,
        profile,
        home,
        shared,
        pantry,
        deadline,
      });
    } catch (error) {
      logEvent("warn", "shopping_check_failed", { month: data.month, error: String(error) });
    }
  }

  // Se escribe sobre la versión más reciente (ticket 21): las rondas tardan y la
  // persona puede haber cambiado un plato o marcado algo mientras. Solo entra un
  // cambio de plato cuya celda sigue igual, y la compra se repara sobre la lista
  // de ese momento, con sus marcas.
  // `as`: sin él TypeScript no ve la asignación dentro de `rebuild` y los da por null.
  let fit = null as PlanFitMark | null;
  let existing = null as PlanFitMark | null;
  let shoppingCheck = null as ShoppingCheckMark | null;
  let late: string[] = [];
  try {
    await updatePlanRowCas<{ plan: unknown; shopping: unknown; updated_at: string }>(
      ctx.userId,
      data.month,
      "plan, shopping",
      (latestRow) => {
        const latest = cleanPlan(latestRow.plan);
        existing = latest?.fit ?? null;
        if (!latest) return null;
        let next = latest;
        fit = null;
        if (doFit && !latest.fit) {
          const { plan: applied, applied: stillThere } = applyPlanFitChanges(
            latest,
            changed,
            data.today,
          );
          fit = { at: new Date().toISOString(), ...scores, changed: stillThere };
          next = { ...applied, fit };
        }
        let nextShopping: ShoppingList | null = null;
        shoppingCheck = null;
        if (!latest.shoppingCheck && (check || !canTouchShared)) {
          if (check) {
            next = check.markOut(next);
            const result = check.repair(next, cleanShopping(latestRow.shopping));
            nextShopping = result.shopping;
            late = result.late;
            shoppingCheck = {
              at: new Date().toISOString(),
              added: result.added,
              raised: result.raised,
            };
          } else {
            // Quien no planifica no decide cantidades: nada que comprobar.
            shoppingCheck = { at: new Date().toISOString(), added: [], raised: [] };
          }
          next = { ...next, shoppingCheck };
        }
        if (next === latest) return null;
        return { plan: next, ...(nextShopping ? { shopping: nextShopping } : {}) };
      },
    );
  } catch (error) {
    console.error("fitMonthlyPlan: guardar", error);
    throw new UserFacingError("No hemos podido guardar el plan ajustado. Inténtalo otra vez.");
  }
  if (shoppingCheck) {
    const { added, raised } = shoppingCheck as ShoppingCheckMark;
    console.info(
      `shoppingCheck ${data.month}: ${added.length} añadidos, ${raised.length} subidos` +
        (late.length ? `, ${late.length} sin arreglo (compra ya hecha)` : ""),
    );
  }
  if (fit && (fit as PlanFitMark).changed.length && canTouchShared) {
    await household.syncSharedMeals({
      supabase: supabase,
      userId: ctx.userId,
      month: data.month,
      today: data.today,
    });
  }
  return { fit: fit ?? existing, shoppingCheck };
}

/**
 * Lo caro de la comprobación de la compra, fuera de la escritura: las recetas
 * del mes (de la caché), qué comidas no se cocinan en casa y lo que piden los
 * platos. Devuelve cómo aplicarlo sobre la versión más reciente de la fila.
 */
async function prepareCheck(opts: {
  supabase: DbClient;
  userId: string;
  key: string;
  month: string;
  today: string;
  plan: MonthlyPlan;
  profile: ProfilePart | null;
  home: HouseholdContext;
  shared: Awaited<
    ReturnType<(typeof import("@/lib/household.server"))["sharedMealPortionsByDate"]>
  >;
  pantry: string[];
  deadline: ReturnType<typeof requestDeadline>;
}) {
  const [coverage, { getRecipes }, { fetchMonthConstraints }, { recipeSlotOfMoment }] =
    await Promise.all([
      import("@/lib/shopping/coverage.server"),
      import("@/lib/nutrition/recipes.server"),
      import("./generate.server"),
      import("@/lib/nutrition/validate-recipe"),
    ]);
  const { mealsForDate } = await import("@/lib/plan-shared");
  const { dateInMonth, daysInMonth } = await import("@/lib/dates");
  const selected = effectiveMealSlots(opts.profile ?? {});

  const constraints = await fetchMonthConstraints(opts.supabase, opts.userId, opts.month);
  const outPlan = await coverage.markMealsOut({
    plan: opts.plan,
    month: opts.month,
    after: opts.today,
    constraints,
    key: opts.key,
    userId: opts.userId,
    profile: opts.profile,
    homeText: opts.home.text,
    deadline: opts.deadline,
  });
  const outCells = outPlan.weeks.flatMap((week, wi) =>
    week.days.flatMap((day, di) =>
      (day.out ?? [])
        .filter((slot) => !opts.plan.weeks[wi]?.days[di]?.out?.includes(slot))
        .map((slot) => ({ wi, di, slot })),
    ),
  );

  const dates = Array.from({ length: daysInMonth(opts.month) }, (_, i) =>
    dateInMonth(opts.month, i + 1),
  ).filter((date) => date > opts.today);
  const meals = dates.flatMap((date) => mealsForDate(outPlan, date, selected));
  const recipes = await getRecipes(
    meals.map((meal) => meal.idea),
    {
      apiKey: opts.key,
      userId: opts.userId,
      deadline: opts.deadline,
      slots: new Map(meals.map((meal) => [meal.idea.trim(), recipeSlotOfMoment(meal.moment)])),
    },
  );
  const needs = coverage.dishNeeds({
    plan: outPlan,
    month: opts.month,
    after: opts.today,
    selected,
    shared: opts.shared,
    servings: opts.home.servings,
    recipes,
  });
  const pantry = coverage.pantryFamilies(opts.pantry);

  return {
    /** Las comidas fuera que se han deducido, sobre la versión más reciente. */
    markOut: (plan: MonthlyPlan): MonthlyPlan => ({
      ...plan,
      outMarked: true,
      weeks: plan.weeks.map((week, wi) => ({
        ...week,
        days: week.days.map((day, di) => {
          const add = outCells.filter((c) => c.wi === wi && c.di === di).map((c) => c.slot);
          if (!add.length) return day;
          return { ...day, out: [...new Set([...(day.out ?? []), ...add])] };
        }),
      })),
    }),
    repair: (plan: MonthlyPlan, shopping: ShoppingList) =>
      coverage.repairShopping({
        plan,
        shopping,
        month: opts.month,
        today: opts.today,
        needs,
        pantry,
      }),
  };
}
