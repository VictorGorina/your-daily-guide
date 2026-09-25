/**
 * Métricas de EXACTITUD de una descomposición frente a su receta de referencia
 * (`precision-nutricional`, ticket 02).
 *
 * El eval de cobertura (`dish-coverage.ts`) mide confianza y rangos: da "100 %
 * de calidad" con errores del 40 % dentro (hallazgo H5). Esto mide el error de
 * verdad — cuánto se aleja cada cifra de la referencia.
 *
 * Puro: no conoce la tabla de composición ni el modelo. Recibe las dos raciones
 * YA en la misma base (gramos tal como los mide la tabla vigente y macros por
 * ingrediente, ver `golden.ts`) y las compara. Así se puede testear sin red.
 */

/** Un ingrediente de una ración, ya expresado en la base de la tabla. */
export type PortionItem = {
  /**
   * Identidad para comparar presencia: dos filas que son el mismo ingrediente
   * (arroz seco y arroz cocido, los tres aceites) comparten `id`.
   */
  id: string;
  grams: number;
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

export type DishAccuracy = {
  kcalRef: number;
  kcalOut: number;
  /** Error relativo con signo: +0,2 = la salida da un 20 % de más. */
  kcalErr: number;
  /**
   * Error relativo con signo de la densidad (kcal por 100 g de plato). No depende
   * del tamaño de la ración: separa "se equivocó en la composición" de "se
   * equivocó en la cantidad". `null` si alguna ración no tiene masa.
   */
  densityErr: number | null;
  proteinErr: number;
  carbsErr: number;
  fatErr: number;
  /**
   * La mayor diferencia, en puntos porcentuales, del % de kcal que aportan
   * proteína, carbohidratos y grasa (Atwater 4/4/9).
   */
  splitPts: number;
  /** Ingredientes principales de la referencia que faltan en la salida. */
  omitted: string[];
  /** Ingredientes principales de la salida que no están en la referencia. */
  invented: string[];
  /** Ingrediente principal de la referencia (el de más kcal). */
  mainId: string | null;
  /** Error relativo con signo de los gramos del ingrediente principal; `null` si falta. */
  mainGramsErr: number | null;
  /** Gramos de aceite de la salida menos los de la referencia. */
  oilGramsDiff: number;
};

/** Identidad común de los aceites: mismas macros, da igual cuál ponga el modelo. */
export const OIL_ID = "aceite";

/**
 * Por debajo de esto, el error de un macro se mide contra este suelo y no contra
 * la referencia: 0,5 g de grasa frente a 1 g no es un error del 100 % que deba
 * pesar en la media.
 */
export const MACRO_FLOOR_G = 5;

/**
 * Un ingrediente es "principal" si aporta al menos esta fracción de las kcal o
 * de la masa del plato. La masa cuenta aparte para no ignorar el calabacín de
 * una crema, que pesa mucho y aporta poca energía pero cambia la densidad.
 */
export const MAIN_KCAL_SHARE = 0.1;
export const MAIN_MASS_SHARE = 0.2;

type Totals = { grams: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number };

export function totalsOf(items: PortionItem[]): Totals {
  const t: Totals = { grams: 0, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const item of items) {
    t.grams += item.grams;
    t.kcal += item.kcal;
    t.protein_g += item.protein_g;
    t.carbs_g += item.carbs_g;
    t.fat_g += item.fat_g;
  }
  return t;
}

/** Agrupa por identidad: dos filas del mismo ingrediente cuentan como una. */
function byId(items: PortionItem[]): Map<string, PortionItem> {
  const out = new Map<string, PortionItem>();
  for (const item of items) {
    const prev = out.get(item.id);
    out.set(
      item.id,
      prev
        ? {
            id: item.id,
            grams: prev.grams + item.grams,
            kcal: prev.kcal + item.kcal,
            protein_g: prev.protein_g + item.protein_g,
            carbs_g: prev.carbs_g + item.carbs_g,
            fat_g: prev.fat_g + item.fat_g,
          }
        : { ...item },
    );
  }
  return out;
}

function mainIds(grouped: Map<string, PortionItem>, totals: Totals): Set<string> {
  const out = new Set<string>();
  for (const item of grouped.values()) {
    const kcalShare = totals.kcal > 0 ? item.kcal / totals.kcal : 0;
    const massShare = totals.grams > 0 ? item.grams / totals.grams : 0;
    if (kcalShare >= MAIN_KCAL_SHARE || massShare >= MAIN_MASS_SHARE) out.add(item.id);
  }
  return out;
}

const relErr = (out: number, ref: number): number => (ref > 0 ? (out - ref) / ref : 0);

const macroErr = (out: number, ref: number): number => (out - ref) / Math.max(ref, MACRO_FLOOR_G);

/** % de kcal que aporta cada macro (Atwater), en puntos 0-100. */
function split(t: Totals): [number, number, number] {
  const p = t.protein_g * 4;
  const c = t.carbs_g * 4;
  const f = t.fat_g * 9;
  const sum = p + c + f;
  if (sum <= 0) return [0, 0, 0];
  return [(p / sum) * 100, (c / sum) * 100, (f / sum) * 100];
}

/** Compara una ración de salida con su referencia. */
export function accuracyOf(reference: PortionItem[], output: PortionItem[]): DishAccuracy {
  const refT = totalsOf(reference);
  const outT = totalsOf(output);
  const refById = byId(reference);
  const outById = byId(output);

  const refMain = mainIds(refById, refT);
  const outMain = mainIds(outById, outT);
  const omitted = [...refMain].filter((id) => !outById.has(id));
  const invented = [...outMain].filter((id) => !refById.has(id));

  let main: PortionItem | null = null;
  for (const item of refById.values()) if (!main || item.kcal > main.kcal) main = item;
  const mainOut = main ? outById.get(main.id) : undefined;

  const refDensity = refT.grams > 0 ? refT.kcal / refT.grams : null;
  const outDensity = outT.grams > 0 ? outT.kcal / outT.grams : null;

  const [rp, rc, rf] = split(refT);
  const [op, oc, of] = split(outT);

  return {
    kcalRef: refT.kcal,
    kcalOut: outT.kcal,
    kcalErr: relErr(outT.kcal, refT.kcal),
    densityErr: refDensity && outDensity !== null ? (outDensity - refDensity) / refDensity : null,
    proteinErr: macroErr(outT.protein_g, refT.protein_g),
    carbsErr: macroErr(outT.carbs_g, refT.carbs_g),
    fatErr: macroErr(outT.fat_g, refT.fat_g),
    splitPts: Math.max(Math.abs(op - rp), Math.abs(oc - rc), Math.abs(of - rf)),
    omitted,
    invented,
    mainId: main?.id ?? null,
    mainGramsErr: main && mainOut ? relErr(mainOut.grams, main.grams) : null,
    oilGramsDiff: (outById.get(OIL_ID)?.grams ?? 0) - (refById.get(OIL_ID)?.grams ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Varias pasadas del mismo plato
// ---------------------------------------------------------------------------

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Media de varias pasadas del mismo plato (el eval repite cada plato sin caché
 * para medir el determinismo). Las listas de omitidos/inventados son la unión:
 * un ingrediente que se omite en una de tres pasadas también es un fallo.
 */
export function meanAccuracy(passes: DishAccuracy[]): DishAccuracy {
  if (!passes.length) throw new Error("meanAccuracy: sin pasadas");
  if (passes.length === 1) return passes[0];
  const densities = passes.map((p) => p.densityErr).filter((d): d is number => d !== null);
  const mains = passes.map((p) => p.mainGramsErr).filter((d): d is number => d !== null);
  return {
    kcalRef: passes[0].kcalRef,
    kcalOut: mean(passes.map((p) => p.kcalOut)),
    kcalErr: mean(passes.map((p) => p.kcalErr)),
    densityErr: densities.length ? mean(densities) : null,
    proteinErr: mean(passes.map((p) => p.proteinErr)),
    carbsErr: mean(passes.map((p) => p.carbsErr)),
    fatErr: mean(passes.map((p) => p.fatErr)),
    splitPts: mean(passes.map((p) => p.splitPts)),
    omitted: [...new Set(passes.flatMap((p) => p.omitted))],
    invented: [...new Set(passes.flatMap((p) => p.invented))],
    mainId: passes[0].mainId,
    mainGramsErr: mains.length ? mean(mains) : null,
    oilGramsDiff: mean(passes.map((p) => p.oilGramsDiff)),
  };
}

/**
 * Dispersión de las kcal de un plato entre pasadas: desviación típica y
 * coeficiente de variación (%). 0 = el mismo plato da siempre la misma cifra.
 */
export function spreadOf(kcals: number[]): { stdevKcal: number; cvPct: number } {
  if (kcals.length < 2) return { stdevKcal: 0, cvPct: 0 };
  const m = mean(kcals);
  const variance = mean(kcals.map((k) => (k - m) ** 2));
  const stdev = Math.sqrt(variance);
  return { stdevKcal: stdev, cvPct: m > 0 ? (stdev / m) * 100 : 0 };
}

// ---------------------------------------------------------------------------
// Resumen del banco
// ---------------------------------------------------------------------------

/** Percentil por rango más cercano (p en 0-100). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export type AccuracySummary = {
  dishes: number;
  /** kcal por ración: error medio absoluto y P90, en %. */
  kcalMeanAbsPct: number;
  kcalP90AbsPct: number;
  /** Media CON signo, en %: + = el pipeline tiende a dar de más. */
  kcalBiasPct: number;
  densityMeanAbsPct: number;
  proteinMeanAbsPct: number;
  carbsMeanAbsPct: number;
  fatMeanAbsPct: number;
  splitMeanPts: number;
  /** Principales de la referencia que faltan, sobre el total de principales, en %. */
  omittedPct: number;
  inventedPerDish: number;
  /** Aceite: diferencia media absoluta en gramos. */
  oilMeanAbsG: number;
  /** Determinismo: coeficiente de variación medio de las kcal entre pasadas, en %. */
  meanCvPct: number;
};

const pct = (x: number) => Math.round(x * 1000) / 10;
const round1 = (x: number) => Math.round(x * 10) / 10;

export function summarize(
  results: { accuracy: DishAccuracy; referenceMains: number; cvPct: number }[],
): AccuracySummary {
  const acc = results.map((r) => r.accuracy);
  const abs = (f: (a: DishAccuracy) => number) => mean(acc.map((a) => Math.abs(f(a))));
  const densities = acc.map((a) => a.densityErr).filter((d): d is number => d !== null);
  const totalMains = results.reduce((s, r) => s + r.referenceMains, 0);
  const totalOmitted = acc.reduce((s, a) => s + a.omitted.length, 0);
  return {
    dishes: results.length,
    kcalMeanAbsPct: pct(abs((a) => a.kcalErr)),
    kcalP90AbsPct: pct(
      percentile(
        acc.map((a) => Math.abs(a.kcalErr)),
        90,
      ),
    ),
    kcalBiasPct: pct(mean(acc.map((a) => a.kcalErr))),
    densityMeanAbsPct: pct(mean(densities.map(Math.abs))),
    proteinMeanAbsPct: pct(abs((a) => a.proteinErr)),
    carbsMeanAbsPct: pct(abs((a) => a.carbsErr)),
    fatMeanAbsPct: pct(abs((a) => a.fatErr)),
    splitMeanPts: round1(mean(acc.map((a) => a.splitPts))),
    omittedPct: totalMains ? pct(totalOmitted / totalMains) : 0,
    inventedPerDish: round1(mean(acc.map((a) => a.invented.length))),
    oilMeanAbsG: round1(abs((a) => a.oilGramsDiff)),
    meanCvPct: round1(mean(results.map((r) => r.cvPct))),
  };
}

/** Cuántos ingredientes principales tiene la referencia (denominador de `omittedPct`). */
export function referenceMainCount(reference: PortionItem[]): number {
  return mainIds(byId(reference), totalsOf(reference)).size;
}

/**
 * Por qué un plato sale mal, en una línea, para la lista de peores del informe.
 * Solo nombra lo que pesa: omisiones, inventos, aceite, ingrediente principal y
 * densidad, en ese orden.
 */
export function accuracyReason(a: DishAccuracy): string {
  const parts: string[] = [];
  if (a.omitted.length) parts.push(`omite ${a.omitted.join(", ")}`);
  if (a.invented.length) parts.push(`inventa ${a.invented.join(", ")}`);
  if (Math.abs(a.oilGramsDiff) >= 5) {
    parts.push(`aceite ${a.oilGramsDiff > 0 ? "+" : ""}${Math.round(a.oilGramsDiff)} g`);
  }
  if (a.mainId && a.mainGramsErr !== null && Math.abs(a.mainGramsErr) >= 0.15) {
    const sign = a.mainGramsErr > 0 ? "+" : "";
    parts.push(`${a.mainId} ${sign}${Math.round(a.mainGramsErr * 100)} % en gramos`);
  }
  if (a.densityErr !== null && Math.abs(a.densityErr) >= 0.15) {
    const sign = a.densityErr > 0 ? "+" : "";
    parts.push(`densidad ${sign}${Math.round(a.densityErr * 100)} %`);
  }
  return parts.join(" · ") || "error repartido, sin una causa dominante";
}

export type IngredientDiff = {
  id: string;
  refGrams: number;
  outGrams: number;
  /** kcal de la salida menos las de la referencia para este ingrediente. */
  kcalDiff: number;
};

/**
 * Comparación ingrediente a ingrediente (agrupados por identidad), ordenada por
 * lo que más mueve las kcal. Es lo que permite revisar a mano un plato que sale
 * mal: el motivo de una línea (`accuracyReason`) dice el tipo de fallo, esto
 * dice dónde están las calorías de más o de menos.
 */
export function ingredientDiff(reference: PortionItem[], output: PortionItem[]): IngredientDiff[] {
  const ref = byId(reference);
  const out = byId(output);
  const ids = new Set([...ref.keys(), ...out.keys()]);
  return [...ids]
    .map((id) => ({
      id,
      refGrams: ref.get(id)?.grams ?? 0,
      outGrams: out.get(id)?.grams ?? 0,
      kcalDiff: (out.get(id)?.kcal ?? 0) - (ref.get(id)?.kcal ?? 0),
    }))
    .sort((a, b) => Math.abs(b.kcalDiff) - Math.abs(a.kcalDiff));
}
