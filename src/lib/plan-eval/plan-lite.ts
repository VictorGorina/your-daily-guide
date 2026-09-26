/**
 * Eval del plan con objetivo (ticket 23 de `precision-nutricional`): ¿el plan
 * que genera el modelo, con la estructura de comida y la ración personal,
 * cuadra con el objetivo de cada persona?
 *
 * Para cada tipología genera el plan del mes que viene con el MISMO generador
 * que producción (`generatePlanBody`), toma los primeros `--days` días y suma
 * cada comida con su receta canónica frente al objetivo (`energyTargets`), de
 * dos formas:
 *
 * - "sin escalar": receta × el factor `plan` de la persona (ticket 21), como
 *   hasta el ticket 08;
 * - "escalado": cada plato al objetivo de su comida (`plannedMacros`) y el día
 *   cerrado (`closeDay`: lo que una comida no alcanza lo absorben las demás),
 *   lo que enseña Hoy. Cada comida se imprime sin escalar → escalada sola →
 *   con el día cerrado.
 *
 * Mide días a ±15 % y a ±5 % del objetivo (el 10 pide ≥ 90 % a ±5 %), la
 * proteína del día frente a la suya y las comidas principales de un solo
 * componente (objetivo: ninguna).
 *
 * Gasta llamadas (plan con PLAN_MODEL + recetas nuevas con DISH_MODEL). Se corre
 * a mano:
 *
 *     bun run eval:plan-lite                 # todas las tipologías, 7 días
 *     bun run eval:plan-lite --only mujer --days 3
 *     bun run eval:plan-lite --no-fit        # sin la ronda de `planFit` (ticket 10)
 */

import { parseArgs } from "node:util";

import { emptyContext } from "@/lib/household.server";
import { energyTargets } from "@/lib/nutrition/energy";
import { resolveServing } from "@/lib/nutrition/planned-serving.server";
import { portionFactors } from "@/lib/nutrition/portion";
import { macrosOfRecipe } from "@/lib/nutrition/recipe";
import { getRecipes } from "@/lib/nutrition/recipes.server";
import { serveDay } from "@/lib/nutrition/day-close";
import { plannedMacros } from "@/lib/nutrition/scale";
import { recipeSlotOfMoment } from "@/lib/nutrition/validate-recipe";
import { _fitPlanForEval, _generatePlanBodyForEval } from "@/lib/plan.functions";
import { mealsForDate, MEAL_SLOTS, monthCoverage } from "@/lib/plan-shared";

type Typology = { id: string; label: string; profile: Record<string, unknown> };

/** Las tipologías del spec (ticket 21: los mismos perfiles que sus ejemplos). */
const TYPOLOGIES: Typology[] = [
  {
    id: "mujer",
    label: "Mujer, 32 años, 62 kg, sedentaria, perder",
    profile: {
      sex: "Mujer",
      age: 32,
      height_cm: 165,
      current_weight_kg: 62,
      target_weight_kg: 57,
      activity_level: "sedentario",
    },
  },
  {
    id: "hombre",
    label: "Hombre, 40 años, 85 kg, ligero, mantener",
    profile: {
      sex: "Hombre",
      age: 40,
      height_cm: 178,
      current_weight_kg: 85,
      target_weight_kg: 85,
      activity_level: "ligero",
    },
  },
  {
    id: "ganar",
    label: "Hombre, 24 años, 78 kg, alto, ganar",
    profile: {
      sex: "Hombre",
      age: 24,
      height_cm: 183,
      current_weight_kg: 78,
      target_weight_kg: 84,
      activity_level: "muy activo",
    },
  },
];

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    only: { type: "string" },
    days: { type: "string", default: "7" },
    "no-fit": { type: "boolean", default: false },
  },
});
const days = Math.max(1, Math.min(28, Number(args.days) || 7));
const key = process.env.OPENROUTER_API_KEY;
if (!key) {
  console.error("Falta OPENROUTER_API_KEY");
  process.exit(1);
}

const now = new Date();
const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const month = next.toISOString().slice(0, 7);

let inBand = 0;
let scaledIn15 = 0;
let scaledIn5 = 0;
let proteinOk = 0;
let totalDays = 0;
let singleComponent = 0;
let mainMeals = 0;

for (const t of TYPOLOGIES.filter((x) => !args.only || x.id === args.only)) {
  const profile = { ...t.profile, budget_month_eur: 0, meals_to_plan: null };
  const targets = energyTargets(profile as never);
  const factor = portionFactors(targets, profile as { sex?: string }).plan;
  console.log(`\n## ${t.label} — objetivo ${targets?.kcal} kcal, ración ×${factor}`);
  const started = performance.now();
  // Sin persona detrás (userId vacío): el gasto del eval no cuenta contra ningún tope.
  const generated = await _generatePlanBodyForEval({
    key,
    userId: "",
    month,
    cadence: "semanal",
    coverage: monthCoverage(month, `${month}-01`),
    home: emptyContext(),
    profile,
    constraints: null,
  });
  console.log(`  plan en ${((performance.now() - started) / 1000).toFixed(0)} s`);

  // La ronda de `planFit` (ticket 10), como `fitMonthlyPlan` en producción,
  // sobre los días que se miden: el resto del mes solo gastaría recetas.
  let plan = generated.plan;
  if (!args["no-fit"]) {
    const fitStarted = performance.now();
    const { plan: fitted, report } = await _fitPlanForEval({
      key,
      plan: { ...plan, coverage: { fromDay: 1, toDay: days } },
      shopping: generated.shopping,
      month,
      profile,
    });
    plan = fitted;
    const pct = (n: number) => `${Math.round(n * 100)} %`;
    console.log(
      `  planFit en ${((performance.now() - fitStarted) / 1000).toFixed(0)} s: ` +
        `${pct(report.before)} → ${pct(report.after)} de ${report.measuredDays} días; ` +
        `${report.misfits} a cambiar, ${report.changed.length} cambiados, ${report.discarded} descartados` +
        (report.seconds
          ? ` (recetas ${report.seconds.recipes} s · modelo ${report.seconds.ask} s · nuevas ${report.seconds.newRecipes} s)`
          : ""),
    );
    for (const c of report.changed) console.log(`    ${c.date} ${c.slot}: ${c.from} → ${c.to}`);
  }

  const dates = Array.from(
    { length: days },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
  const meals = dates.flatMap((date) =>
    mealsForDate(plan, date, MEAL_SLOTS).map((m) => ({ ...m, date })),
  );
  const recipes = await getRecipes(
    meals.map((m) => m.idea),
    {
      apiKey: key,
      userId: null,
      slots: new Map(meals.map((m) => [m.idea.trim(), recipeSlotOfMoment(m.moment)])),
    },
  );

  const own = portionFactors(targets, profile as { sex?: string });
  const servingCtx = { own, energy: targets, shared: {}, kcalAdjust: null };
  const pct = (err: number) => `${err >= 0 ? "+" : ""}${Math.round(err * 100)} %`;
  for (const date of dates) {
    const today = meals.filter((m) => m.date === date && m.idea);
    let kcal = 0;
    let missing = 0;
    const lines: string[] = [];
    for (const m of today) {
      if (m.slot === "comida" || m.slot === "cena") {
        mainMeals += 1;
        if (!m.idea.includes("·")) singleComponent += 1;
      }
      if (!recipes.get(m.idea.trim())?.recipe) missing += 1;
    }
    // El día como lo enseña Hoy: cada plato a su comida y el día cerrado.
    const day = serveDay(
      today.map((m) => {
        const { serving, goal, shared } = resolveServing(m.moment, servingCtx);
        return { recipe: recipes.get(m.idea.trim())?.recipe ?? null, serving, goal, shared };
      }),
    );
    const scaled = day.total.kcal;
    const protein = day.total.protein_g;
    today.forEach((m, i) => {
      const recipe = recipes.get(m.idea.trim())?.recipe;
      if (!recipe) {
        lines.push(`      ${m.moment}: ${m.idea} (sin calcular)`);
        return;
      }
      const flat = macrosOfRecipe(recipe, factor).kcal;
      const alone = plannedMacros(recipe, resolveServing(m.moment, servingCtx).serving).macros;
      kcal += flat;
      const goal = targets?.perSlot[m.slot]?.kcal;
      lines.push(
        `      ${m.moment}: ${flat} → ${alone.kcal} → ${day.meals[i]!.kcal} kcal` +
          `${goal ? ` (objetivo ${goal})` : ""} · ${m.idea}`,
      );
    });
    const err = targets ? (kcal - targets.kcal) / targets.kcal : 0;
    const errScaled = targets ? (scaled - targets.kcal) / targets.kcal : 0;
    const ok = Math.abs(err) <= 0.15 && !missing;
    totalDays += 1;
    if (ok) inBand += 1;
    if (!missing && Math.abs(errScaled) <= 0.15) scaledIn15 += 1;
    if (!missing && Math.abs(errScaled) <= 0.05) scaledIn5 += 1;
    if (!missing && targets && protein >= 0.9 * targets.protein_g) proteinOk += 1;
    console.log(
      `  ${date}: sin escalar ${kcal} kcal (${pct(err)}) · escalado ${scaled} kcal (${pct(errScaled)})` +
        ` · proteína ${protein}/${targets?.protein_g ?? "?"} g` +
        `${missing ? ` · ${missing} sin calcular` : ""}`,
    );
    for (const line of lines) console.log(line);
  }
}

const share = (n: number) =>
  `${n}/${totalDays} (${Math.round((n / Math.max(1, totalDays)) * 100)} %)`;
console.log(
  `\nSin escalar, días a ±15 %: ${share(inBand)}` +
    `\nEscalado, días a ±15 %: ${share(scaledIn15)} · a ±5 %: ${share(scaledIn5)} (el 10 pide ≥ 90 %)` +
    `\nEscalado, proteína ≥ 90 % del objetivo: ${share(proteinOk)}` +
    `\nComidas principales de un solo componente: ${singleComponent}/${mainMeals} (objetivo 0)`,
);
