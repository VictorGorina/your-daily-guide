/**
 * Eval del plan con objetivo (ticket 23 de `precision-nutricional`): ¿el plan
 * que genera el modelo, con la estructura de comida y la ración personal,
 * cuadra con el objetivo de cada persona?
 *
 * Para cada tipología genera el plan del mes que viene con el MISMO generador
 * que producción (`generatePlanBody`), toma los primeros `--days` días y suma
 * cada comida con su receta canónica × el factor `plan` de la persona (ticket
 * 21), frente a su objetivo (`energyTargets`). Mide:
 *
 * - días a ±15 % del objetivo (objetivo provisional: ≥ 70 %; el 10 lo lleva a ±5 %);
 * - comidas principales de un solo componente (objetivo: ninguna).
 *
 * Gasta llamadas (plan con PLAN_MODEL + recetas nuevas con DISH_MODEL). Se corre
 * a mano:
 *
 *     bun run eval:plan-lite                 # todas las tipologías, 7 días
 *     bun run eval:plan-lite --only mujer --days 3
 */

import { parseArgs } from "node:util";

import { emptyContext } from "@/lib/household.server";
import { energyTargets } from "@/lib/nutrition/energy";
import { portionFactors } from "@/lib/nutrition/portion";
import { macrosOfRecipe } from "@/lib/nutrition/recipe";
import { getRecipes } from "@/lib/nutrition/recipes.server";
import { recipeSlotOfMoment } from "@/lib/nutrition/validate-recipe";
import { _generatePlanBodyForEval } from "@/lib/plan.functions";
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
  options: { only: { type: "string" }, days: { type: "string", default: "7" } },
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
  const { plan } = await _generatePlanBodyForEval({
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

  for (const date of dates) {
    const today = meals.filter((m) => m.date === date && m.idea);
    let kcal = 0;
    let missing = 0;
    for (const m of today) {
      if (m.slot === "comida" || m.slot === "cena") {
        mainMeals += 1;
        if (!m.idea.includes("·")) singleComponent += 1;
      }
      const recipe = recipes.get(m.idea.trim())?.recipe;
      if (recipe) kcal += macrosOfRecipe(recipe, factor).kcal;
      else missing += 1;
    }
    const err = targets ? (kcal - targets.kcal) / targets.kcal : 0;
    const ok = Math.abs(err) <= 0.15 && !missing;
    totalDays += 1;
    if (ok) inBand += 1;
    console.log(
      `  ${date}: ${kcal} kcal (${err >= 0 ? "+" : ""}${Math.round(err * 100)} %)` +
        `${missing ? ` · ${missing} sin calcular` : ""}${ok ? "" : " ✗"}`,
    );
    for (const m of today) console.log(`      ${m.moment}: ${m.idea}`);
  }
}

console.log(
  `\nDías a ±15 % del objetivo: ${inBand}/${totalDays} (${Math.round((inBand / Math.max(1, totalDays)) * 100)} %; objetivo ≥ 70 %)` +
    ` · comidas principales de un solo componente: ${singleComponent}/${mainMeals} (objetivo 0)`,
);
