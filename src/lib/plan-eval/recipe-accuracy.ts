/**
 * Eval de EXACTITUD — cuánto se equivocan las cifras frente a recetas de
 * referencia (`precision-nutricional`, ticket 02).
 *
 * Dos medidas, porque son dos errores distintos:
 *
 * 1. **Error de la tabla** (`golden-external.data.ts`): la fila a la que
 *    `matchFood` lleva cada nombre frente a una referencia externa por 100 g.
 *    No gasta llamadas.
 * 2. **Error de la descomposición** (`golden-recipes.data.ts`): cada plato pasa
 *    por el pipeline actual (`decomposeDishes`, el mismo de producción) varias
 *    veces sin caché, y se compara con su receta de referencia en la misma base
 *    de tabla (`toTableBasis`). Las varias pasadas miden el determinismo.
 *
 * No es un test unitario: gasta llamadas al modelo. Se corre a mano:
 *
 *     bun run eval:recipes                        # todo, 3 pasadas
 *     bun run eval:recipes --passes 1 --limit 10  # prueba rápida
 *     bun run eval:recipes --reviewed             # solo recetas revisadas a mano
 *     bun run eval:recipes --model openai/gpt-5-mini
 *     bun run eval:recipes --save-baseline        # fija la línea base
 *
 * Escribe `eval-report.md` (resumen, objetivos del spec, los 15 peores platos y
 * el error de la tabla) y, si existe `baseline-recipes.json`, compara con ella.
 * Necesita `OPENROUTER_API_KEY` para la parte 2 (lee `.env`); sin ella solo
 * corre la parte 1.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { DISH_MODEL } from "@/lib/ai-provider.server";
import { decomposeDishes, type DishBreakdown } from "@/lib/nutrition/resolve-dish.server";
import type { RecipeSlot } from "@/lib/nutrition/validate-recipe";

import {
  accuracyOf,
  accuracyReason,
  ingredientDiff,
  meanAccuracy,
  referenceMainCount,
  spreadOf,
  summarize,
  type AccuracySummary,
  type DishAccuracy,
  type IngredientDiff,
} from "./accuracy";
import {
  fromResolved,
  tableErrorOf,
  toTableBasis,
  validateGolden,
  type TableError,
} from "./golden";
import { GOLDEN_EXTERNAL } from "./golden-external.data";
import { GOLDEN_RECIPES } from "./golden-recipes.data";

const BATCH = 8;
const REPORT_URL = new URL("./eval-report.md", import.meta.url);
const BASELINE_URL = new URL("./baseline-recipes.json", import.meta.url);

/**
 * Objetivos del spec (`.scratch/precision-nutricional/spec.md`, "Criterios de
 * éxito"). `max` = el valor medido tiene que quedar por debajo o igual.
 */
const TARGETS: { key: keyof AccuracySummary; label: string; max: number; unit: string }[] = [
  { key: "kcalMeanAbsPct", label: "kcal por ración, error medio", max: 6, unit: "%" },
  { key: "kcalP90AbsPct", label: "kcal por ración, P90", max: 12, unit: "%" },
  { key: "densityMeanAbsPct", label: "kcal por 100 g, error medio", max: 6, unit: "%" },
  { key: "splitMeanPts", label: "reparto de macros", max: 3, unit: " pts" },
  { key: "proteinMeanAbsPct", label: "proteína por ración, error medio", max: 8, unit: "%" },
  { key: "omittedPct", label: "ingredientes principales omitidos", max: 1, unit: "%" },
  { key: "meanCvPct", label: "mismo plato → mismas cifras (CV entre pasadas)", max: 0, unit: "%" },
];

type DishResult = {
  dish: string;
  slot: string;
  reviewed: boolean;
  /** Pasadas en las que el pipeline no devolvió ingredientes. */
  unresolved: number;
  accuracy: DishAccuracy;
  referenceMains: number;
  cvPct: number;
  stdevKcal: number;
  diff: IngredientDiff[];
};

type Baseline = {
  ranAt: string;
  model: string;
  passes: number;
  summary: AccuracySummary;
  tableSummary: ReturnType<typeof summarizeTable>;
  dishes: {
    dish: string;
    kcalRef: number;
    kcalOut: number;
    kcalErrPct: number;
    cvPct: number;
    reason: string;
  }[];
};

const round = (x: number) => Math.round(x);
const signedPct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)} %`;

function summarizeTable(errors: TableError[]) {
  const share = (n: number) => (errors.length ? Math.round((n / errors.length) * 1000) / 10 : 0);
  const meanAbs = (f: (e: TableError) => number) =>
    share(errors.reduce((s, e) => s + Math.abs(f(e)), 0));
  return {
    references: errors.length,
    matchedRightPct: share(errors.filter((e) => e.matchedRight).length),
    missingRows: errors.filter((e) => !e.expectedExists).length,
    kcalMeanAbsPct: meanAbs((e) => e.kcalErr),
    proteinMeanAbsPct: meanAbs((e) => e.proteinErr),
    fatMeanAbsPct: meanAbs((e) => e.fatErr),
  };
}

async function decomposeAll(
  dishes: string[],
  model: string,
  slots: ReadonlyMap<string, RecipeSlot>,
): Promise<{ breakdowns: Map<string, DishBreakdown>; seconds: number }> {
  // `decomposeDishes` no guarda nada (la caché es `getRecipes`): cada pasada
  // descompone de verdad, así que el determinismo mide al modelo.
  const breakdowns = new Map<string, DishBreakdown>();
  const started = performance.now();
  for (let i = 0; i < dishes.length; i += BATCH) {
    const batch = dishes.slice(i, i + BATCH);
    // Sin persona detrás: el gasto del eval no cuenta contra ningún tope.
    const map = await decomposeDishes(batch, { userId: null, model, slots });
    for (const [k, v] of map) breakdowns.set(k, v);
    process.stdout.write(`    ${Math.min(i + BATCH, dishes.length)}/${dishes.length}\r`);
  }
  return { breakdowns, seconds: (performance.now() - started) / 1000 };
}

function readBaseline(): Baseline | null {
  if (!existsSync(BASELINE_URL)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_URL, "utf8")) as Baseline;
  } catch {
    return null;
  }
}

async function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      passes: { type: "string", default: "3" },
      limit: { type: "string" },
      dish: { type: "string" },
      model: { type: "string", default: DISH_MODEL },
      reviewed: { type: "boolean", default: false },
      "save-baseline": { type: "boolean", default: false },
    },
  });
  const passes = Math.max(1, Number(args.passes) || 3);
  const model = args.model ?? DISH_MODEL;

  // Un golden set roto no mide nada: se para antes de gastar una llamada.
  const broken = GOLDEN_RECIPES.flatMap((r) => validateGolden(r).map((p) => `  ${r.dish}: ${p}`));
  if (broken.length) {
    console.error("Recetas de referencia inválidas:\n" + broken.join("\n"));
    process.exit(1);
  }

  const lines: string[] = [];
  const log = (line = "") => {
    console.log(line);
    lines.push(line);
  };

  log(`# Eval de exactitud — ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
  log();

  // ---- 1. Error de la tabla (sin llamadas) -------------------------------
  const tableErrors = GOLDEN_EXTERNAL.map(tableErrorOf);
  const tableSummary = summarizeTable(tableErrors);
  log(`## Tabla de composición frente a referencias externas (${tableErrors.length})`);
  log();
  if (tableErrors.length) {
    log(
      `Casado a la fila correcta: ${tableSummary.matchedRightPct} % · ` +
        `filas que faltan: ${tableSummary.missingRows} · ` +
        `kcal/100 g, error medio: ${tableSummary.kcalMeanAbsPct} % · ` +
        `proteína: ${tableSummary.proteinMeanAbsPct} % · grasa: ${tableSummary.fatMeanAbsPct} %`,
    );
    log();
    log("_Si no casa con ninguna fila, se mide el genérico de 130 kcal que sumaría producción._");
    log();
    log("| Nombre | Fila que suma hoy | kcal | Proteína | Grasa |");
    log("|---|---|---|---|---|");
    for (const e of [...tableErrors].sort((a, b) => Math.abs(b.kcalErr) - Math.abs(a.kcalErr))) {
      const matched = e.matchedKey ?? "genérico";
      const row = e.matchedRight
        ? matched
        : e.expectedExists
          ? `⚠ ${matched} (debería ser ${e.expectedKey})`
          : `⚠ ${matched} (falta fila \`${e.expectedKey}\`)`;
      log(
        `| ${e.name} | ${row} | ${signedPct(e.kcalErr)} | ${signedPct(e.proteinErr)} | ` +
          `${signedPct(e.fatErr)} |`,
      );
    }
  } else {
    log("_Sin referencias externas todavía._");
  }
  log();

  // ---- 2. Error de la descomposición -------------------------------------
  let recipes = GOLDEN_RECIPES;
  if (args.reviewed) recipes = recipes.filter((r) => r.reviewedBy);
  if (args.dish) {
    const needle = args.dish.toLowerCase();
    recipes = recipes.filter((r) => r.dish.toLowerCase().includes(needle));
  }
  if (args.limit) recipes = recipes.slice(0, Math.max(1, Number(args.limit)));

  const reviewedCount = recipes.filter((r) => r.reviewedBy).length;
  log(`## Descomposición frente a recetas de referencia`);
  log();
  log(
    `Modelo: \`${model}\` · ${recipes.length} platos (${reviewedCount} revisados a mano) · ` +
      `${passes} pasada(s) por plato`,
  );
  log();

  if (!recipes.length) {
    log("_Sin recetas de referencia que medir._");
    writeFileSync(REPORT_URL, lines.join("\n") + "\n");
    return;
  }
  if (!process.env.OPENROUTER_API_KEY) {
    log("_Falta `OPENROUTER_API_KEY`: no se mide la descomposición._");
    writeFileSync(REPORT_URL, lines.join("\n") + "\n");
    return;
  }

  const dishes = recipes.map((r) => r.dish);
  const slots = new Map<string, RecipeSlot>(recipes.map((r) => [r.dish, r.slot]));
  const runs: Map<string, DishBreakdown>[] = [];
  const seconds: number[] = [];
  for (let p = 0; p < passes; p += 1) {
    console.log(`  Pasada ${p + 1}/${passes}…`);
    const { breakdowns, seconds: s } = await decomposeAll(dishes, model, slots);
    runs.push(breakdowns);
    seconds.push(s);
  }
  console.log();

  // Una pasada en la que el pipeline no devolvió ingredientes (la llamada falló
  // o el modelo no supo) NO es una respuesta de "cero kcal": en producción ese
  // plato queda "calculando" y se reintenta (D13). Medirla como salida vacía hundía la
  // exactitud y el determinismo por un fallo de disponibilidad, así que se
  // cuenta aparte y solo las pasadas resueltas entran en las métricas.
  const measured: DishResult[] = [];
  const neverResolved: string[] = [];
  let unresolved = 0;
  for (const recipe of recipes) {
    const reference = toTableBasis(recipe);
    const outputs = runs
      .map((run) => run.get(recipe.dish))
      .filter((b): b is DishBreakdown => !!b && b.source === "model" && b.ingredients.length > 0)
      .map((b) => fromResolved(b.ingredients));
    unresolved += runs.length - outputs.length;
    if (!outputs.length) {
      neverResolved.push(recipe.dish);
      continue;
    }
    const perPass = outputs.map((out) => accuracyOf(reference, out));
    const spread = spreadOf(perPass.map((a) => a.kcalOut));
    measured.push({
      dish: recipe.dish,
      slot: recipe.slot,
      reviewed: !!recipe.reviewedBy,
      unresolved: runs.length - outputs.length,
      accuracy: meanAccuracy(perPass),
      referenceMains: referenceMainCount(reference),
      cvPct: spread.cvPct,
      stdevKcal: spread.stdevKcal,
      // Detalle de la 1.ª pasada resuelta: lo que se revisa a mano en los peores platos.
      diff: ingredientDiff(reference, outputs[0]),
    });
  }
  const results = measured;

  const summary = summarize(results);
  const meanSeconds = seconds.reduce((a, b) => a + b, 0) / seconds.length;

  log(`### Resumen`);
  log();
  log(`| Métrica | Medido | Objetivo | |`);
  log(`|---|---|---|---|`);
  for (const t of TARGETS) {
    const value = summary[t.key];
    log(`| ${t.label} | ${value}${t.unit} | ≤ ${t.max}${t.unit} | ${value <= t.max ? "✓" : "✗"} |`);
  }
  log();
  log(
    `Sesgo de kcal (con signo): ${summary.kcalBiasPct >= 0 ? "+" : ""}${summary.kcalBiasPct} % · ` +
      `carbohidratos: ${summary.carbsMeanAbsPct} % · grasa: ${summary.fatMeanAbsPct} % · ` +
      `aceite: ±${summary.oilMeanAbsG} g · inventados por plato: ${summary.inventedPerDish} · ` +
      `pasadas sin descomponer (fuera de las métricas): ${unresolved}/${recipes.length * passes}`,
  );
  log(`Latencia: ${meanSeconds.toFixed(1)} s por pasada completa (lotes de ${BATCH}).`);
  if (neverResolved.length) {
    log();
    log(`⚠ Sin ninguna pasada resuelta, no medidos: ${neverResolved.join(", ")}.`);
  }
  log();

  const baseline = readBaseline();
  if (baseline && !args["save-baseline"]) {
    log(`### Frente a la línea base (${baseline.ranAt.slice(0, 10)}, \`${baseline.model}\`)`);
    log();
    log(`| Métrica | Base | Ahora |`);
    log(`|---|---|---|`);
    for (const t of TARGETS) {
      log(`| ${t.label} | ${baseline.summary[t.key]}${t.unit} | ${summary[t.key]}${t.unit} |`);
    }
    log();
  }

  const worst = [...results]
    .sort((a, b) => Math.abs(b.accuracy.kcalErr) - Math.abs(a.accuracy.kcalErr))
    .slice(0, 15);
  log(`### Los 15 platos con más error de kcal`);
  log();
  log(`| Plato | Ref. | Salida | Error | CV | Motivo |`);
  log(`|---|---|---|---|---|---|`);
  for (const r of worst) {
    const a = r.accuracy;
    log(
      `| ${r.dish}${r.reviewed ? "" : " ·"} | ${round(a.kcalRef)} | ${round(a.kcalOut)} | ` +
        `${signedPct(a.kcalErr)} | ${r.cvPct.toFixed(0)} % | ${accuracyReason(a)} |`,
    );
  }
  log();
  log(`_· = receta de referencia aún sin revisar a mano._`);
  log();
  log(`#### Dónde están las kcal (1.ª pasada; gramos ref. → salida, kcal de diferencia)`);
  log();
  for (const r of worst) {
    const parts = r.diff
      .filter((d) => Math.abs(d.kcalDiff) >= 5)
      .slice(0, 6)
      .map((d) => {
        const sign = d.kcalDiff > 0 ? "+" : "";
        return `${d.id} ${round(d.refGrams)}→${round(d.outGrams)} g (${sign}${round(d.kcalDiff)})`;
      });
    log(`- **${r.dish}**: ${parts.join(" · ") || "sin diferencias de más de 5 kcal"}`);
  }

  writeFileSync(REPORT_URL, lines.join("\n") + "\n");
  console.log(`\n→ ${REPORT_URL.pathname.split("/").pop()} escrito`);

  if (args["save-baseline"]) {
    const out: Baseline = {
      ranAt: new Date().toISOString(),
      model,
      passes,
      summary,
      tableSummary,
      dishes: results.map((r) => ({
        dish: r.dish,
        kcalRef: round(r.accuracy.kcalRef),
        kcalOut: round(r.accuracy.kcalOut),
        kcalErrPct: Math.round(r.accuracy.kcalErr * 1000) / 10,
        cvPct: Math.round(r.cvPct * 10) / 10,
        reason: accuracyReason(r.accuracy),
      })),
    };
    writeFileSync(BASELINE_URL, JSON.stringify(out, null, 2) + "\n");
    console.log("→ baseline-recipes.json actualizado");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
