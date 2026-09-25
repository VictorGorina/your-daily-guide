/**
 * La cadena de cálculo de `decomposeDishes` (ticket 13 de
 * `precision-nutricional`, D13: todo plato se calcula), sin I/O.
 *
 * Quién pregunta al modelo se inyecta (`ask`): así la cadena se testea sin red
 * (`decompose-chain.test.ts`) y `resolve-dish.server.ts` se queda con lo que
 * de verdad es de servidor (`ai`, la clave, el tope de gasto).
 *
 *  1. Un lote con el modelo principal.
 *  2. Los platos que vuelven vacíos se reintentan uno a uno, en paralelo, con
 *     el mismo modelo: en el eval los fallos venían en lotes enteros, sin
 *     error registrado (24 de 225 pasadas).
 *  3. Los que siguen vacíos, con el modelo de respaldo, de otra familia.
 *  4. Lo que queda sin calcular sale con su motivo; nunca con un promedio.
 */

import { normName } from "@/lib/plan-shared";

export type DecomposeFailure =
  | "sin-clave"
  | "json-invalido"
  | "sin-respuesta"
  | "tiempo"
  | "tope-gasto"
  | "error-modelo"
  /** Descompuesto, pero con ingredientes sin identificar que pesan (ticket 05 §5). */
  | "calidad-baja";

/**
 * Lo que devuelve el modelo por plato, sin resolver todavía contra la tabla
 * (esquema del ticket 05: `resolve-dish.server.ts`). Los campos de clasificación
 * van sin tipar aquí: los lee y sanea quien resuelve la receta.
 */
export type RawDish = {
  comida: boolean;
  vago: boolean;
  /** Uno o dos métodos de cocción (enum de `cooking.ts`). */
  metodos?: unknown;
  /** "plato" | "unidad" (ticket 17: una pizza pesa lo que pesa). */
  tipo_racion?: unknown;
  unidad?: unknown;
  /** Cuánto dice el texto respecto a una ración ("media pizza" = 0,5). */
  cantidad_texto?: unknown;
  ingredientes: Record<string, unknown>[];
};

/** Un paso de la cadena que no ha devuelto nada utilizable, con su motivo. */
export class DecomposeError extends Error {
  constructor(readonly reason: DecomposeFailure) {
    super(reason);
    this.name = "DecomposeError";
  }
}

export function failureOf(error: unknown): DecomposeFailure {
  if (error instanceof DecomposeError) return error.reason;
  const name = (error as { name?: string } | null)?.name ?? "";
  if (name === "RateLimitError") return "tope-gasto";
  if (name === "TimeoutError" || name === "AbortError") return "tiempo";
  // Salida estructurada que no valida contra el esquema (ticket 05): cuenta como
  // JSON inválido, no como un fallo del modelo, para que se vea en el log.
  if (/NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/.test(name)) {
    return "json-invalido";
  }
  return "error-modelo";
}

/**
 * ¿Este resultado ya es definitivo? Con ingredientes, "no es comida" o vago
 * son respuestas; una lista vacía sin ninguna de esas marcas es un fallo.
 */
export const settledRaw = (raw: RawDish | undefined): raw is RawDish =>
  !!raw && (!raw.comida || raw.vago || raw.ingredientes.length > 0);

/**
 * Lee la respuesta del modelo. Lanza `DecomposeError` si no hay nada que leer;
 * los platos que falten en una respuesta válida simplemente no están en el mapa
 * (los recoge el paso siguiente). Indexado por `normName(plato)`.
 */
export function parseDecomposition(
  text: string | null | undefined,
  parse: (text: string) => unknown,
): Map<string, RawDish> {
  if (!text?.trim()) throw new DecomposeError("sin-respuesta");
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch {
    throw new DecomposeError("json-invalido");
  }
  return rawDishesOf(parsed);
}

/**
 * La respuesta ya como objeto (la salida estructurada del ticket 05, o un JSON
 * leído a mano) → un `RawDish` por plato, indexado por `normName(plato)`.
 */
export function rawDishesOf(parsed: unknown): Map<string, RawDish> {
  const platos = (parsed as { platos?: unknown } | null)?.platos;
  if (!Array.isArray(platos)) throw new DecomposeError("json-invalido");

  const out = new Map<string, RawDish>();
  for (const row of platos) {
    const r = (row ?? {}) as Record<string, unknown>;
    const label = normName(String(r.plato ?? ""));
    if (!label) continue;
    out.set(label, {
      comida: r.comida !== false,
      vago: r.vago === true,
      metodos: r.metodos ?? r.coccion,
      tipo_racion: r.tipo_racion,
      unidad: r.unidad,
      cantidad_texto: r.cantidad_texto,
      ingredientes: (Array.isArray(r.ingredientes) ? r.ingredientes : [])
        .slice(0, 30)
        .map((raw) => (raw ?? {}) as Record<string, unknown>),
    });
  }
  return out;
}

/** "1. pasta", "2) pasta", "3 - pasta" → "pasta". Exige el separador para no
 * comerse el número de un plato que empieza por él ("2 huevos fritos"). */
const withoutListNumber = (label: string) => label.replace(/^\s*\d+\s*[.):-]\s*/, "");

/**
 * Casa lo que devolvió el modelo (indexado por su etiqueta, que es texto libre)
 * con los platos pedidos. El prompt numera los platos y a veces el modelo copia
 * el número en TODAS las etiquetas ("1. Pasta…"): sin esto ninguna casaba y el
 * lote entero se perdía, aunque traía los ingredientes bien (2026-09-24).
 *
 * Nunca adivina entre varios: casar dos platos al revés daría cifras
 * equivocadas sin avisar, y es mejor que el plato vuelva a la cola y se
 * reintente solo. Por posición, únicamente un plato pedido con una fila.
 */
export function matchAnswer(
  asked: string[],
  answer: Map<string, RawDish>,
): Map<string, RawDish | undefined> {
  const bare = new Map<string, RawDish | null>();
  for (const [label, raw] of answer) {
    const key = withoutListNumber(label);
    if (key === label) continue;
    // Dos filas que quedan iguales sin el número: ambiguo, no se usa.
    bare.set(key, bare.has(key) ? null : raw);
  }
  const out = new Map<string, RawDish | undefined>();
  for (const dish of asked) {
    const key = normName(dish);
    out.set(dish, answer.get(key) ?? bare.get(key) ?? undefined);
  }
  if (asked.length === 1 && answer.size === 1 && !out.get(asked[0]!)) {
    out.set(asked[0]!, answer.values().next().value);
  }
  return out;
}

/** Pregunta al modelo por varios platos. Lanza si no hay nada utilizable. */
export type AskModel = (
  dishes: string[],
  model: string,
  timeoutMs: number,
) => Promise<Map<string, RawDish>>;

/**
 * Presupuesto de tiempo de cada paso. La cadena entera cabe por debajo del
 * `maxDuration` de la función (300 s, `vite.config.ts`) con margen para el
 * resto de la petición: un lote de 8 platos con `DISH_MODEL` tarda ~60 s
 * medidos, uno solo ~15-25 s, y el modelo de respaldo es mucho más rápido.
 */
export const CHAIN_TIMEOUTS = { batch: 120_000, single: 60_000, fallback: 45_000 } as const;

export type ChainResult = {
  /** Resultado definitivo de cada plato que lo tiene (con receta, vago o "no es comida"). */
  raws: Map<string, RawDish>;
  /** Motivo del último fallo de cada plato que se quedó sin resultado. */
  failures: Map<string, DecomposeFailure>;
  /** Se llegó al tope de gasto mensual: no tiene sentido seguir llamando. */
  capped: boolean;
};

export async function runDecomposeChain(opts: {
  dishes: string[];
  ask: AskModel;
  model: string;
  fallbackModel: string;
  noFallback?: boolean;
  timeouts?: { batch: number; single: number; fallback: number };
}): Promise<ChainResult> {
  const { dishes, ask, model, fallbackModel } = opts;
  const timeouts = opts.timeouts ?? CHAIN_TIMEOUTS;
  const raws = new Map<string, RawDish>();
  const failures = new Map<string, DecomposeFailure>();
  let capped = false;

  const missing = () => dishes.filter((d) => !raws.has(d));
  const step = async (asked: string[], stepModel: string, timeoutMs: number) => {
    if (capped || !asked.length) return;
    try {
      const answer = matchAnswer(asked, await ask(asked, stepModel, timeoutMs));
      for (const dish of asked) {
        const raw = answer.get(dish);
        if (settledRaw(raw)) {
          raws.set(dish, raw);
          failures.delete(dish);
        } else failures.set(dish, "sin-respuesta");
      }
    } catch (error) {
      const reason = failureOf(error);
      for (const dish of asked) failures.set(dish, reason);
      // El tope mensual no se va a mover en los segundos que dura la cadena.
      if (reason === "tope-gasto") capped = true;
    }
  };

  await step(dishes, model, timeouts.batch);
  const retry = missing();
  if (retry.length) await Promise.all(retry.map((d) => step([d], model, timeouts.single)));
  const last = missing();
  if (last.length && !opts.noFallback && fallbackModel !== model) {
    await step(last, fallbackModel, timeouts.fallback);
  }
  return { raws, failures, capped };
}
