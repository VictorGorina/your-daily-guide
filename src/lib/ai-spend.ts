/**
 * Tope de gasto en IA por persona — la parte pura: cuánto ha costado una
 * llamada al modelo y si la siguiente puede pasar. La lectura y escritura de la
 * tabla `ai_spend` viven en `rate-limit.server.ts`, junto a `RATE_LIMITS`; aquí
 * no hay dependencias de servidor para poder testearlo y razonarlo aparte.
 *
 * Días y meses van en UTC, tanto aquí como en `record_ai_spend` (SQL): es un
 * freno contra el abuso, no una métrica que vea la persona, y así el servidor y
 * la base de datos cortan el día en el mismo instante sin leer su zona horaria.
 */

export type AiSpendCaps = { dailyUsd: number; monthlyUsd: number };

/** Fila de `ai_spend` tal como llega de PostgREST (`numeric` puede venir como texto). */
export type AiSpendRow = { day: string; cost_usd: number | string };

export type SpendCapDecision = {
  daySpentUsd: number;
  monthSpentUsd: number;
} & ({ allowed: true } | { allowed: false; scope: "day" | "month"; retryAfterSeconds: number });

/**
 * Precio de cada modelo en OpenRouter, en $ por millón de tokens. Solo se usa
 * si una respuesta llega sin `usage.cost`: mejor contar una estimación que
 * dejar esa llamada fuera del tope. Si cambia el precio de un modelo (o se
 * añade uno nuevo en `ai-provider.server.ts`), cambia esto también.
 */
export const COACH_MODEL_USD_PER_MTOK = { input: 0.3, output: 2.5 } as const;
export const PLAN_MODEL_USD_PER_MTOK = { input: 1.25, output: 10 } as const;
export const DISH_MODEL_USD_PER_MTOK = { input: 1.25, output: 10 } as const;
/** `DISAMBIGUATION_MODEL` (Gemini 2.5 Flash-Lite). */
export const DISAMBIGUATION_MODEL_USD_PER_MTOK = { input: 0.1, output: 0.4 } as const;

const MODEL_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "google/gemini-2.5-flash": COACH_MODEL_USD_PER_MTOK,
  "google/gemini-2.5-flash-lite": DISAMBIGUATION_MODEL_USD_PER_MTOK,
  "google/gemini-2.5-pro": PLAN_MODEL_USD_PER_MTOK,
  "openai/gpt-5": DISH_MODEL_USD_PER_MTOK,
};

/** Lo que miramos de un resultado del modelo: sirve igual para `doGenerate`
 *  que para la parte `finish` de un stream. */
export type CallUsage = {
  usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
  providerMetadata?: Record<string, unknown>;
};

/**
 * Coste en dólares de una llamada. Manda lo que factura OpenRouter
 * (`providerMetadata.openrouter.usage.cost`, que solo llega con
 * `usage: { include: true }`); si no viene, se estima con los tokens al
 * precio de `modelId`. Un modelo que no esté en `MODEL_USD_PER_MTOK` (nuevo,
 * o id mal escrito) cae al precio más caro conocido: mejor sobrestimar contra
 * el tope de gasto que dejar pasar una llamada cara como si fuera barata.
 */
export function callCostUsd({ usage, providerMetadata }: CallUsage, modelId?: string): number {
  const openrouter = providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined;
  const reported = openrouter?.usage?.cost;
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return reported;
  }

  const priceTable = Object.values(MODEL_USD_PER_MTOK);
  const mostExpensive = priceTable.reduce((a, b) =>
    b.input + b.output > a.input + a.output ? b : a,
  );
  // Sin `modelId` (nadie más lo pasa hoy salvo los tests) se asume el modelo
  // por defecto; con un `modelId` presente pero no reconocido, el más caro.
  const price = modelId ? (MODEL_USD_PER_MTOK[modelId] ?? mostExpensive) : COACH_MODEL_USD_PER_MTOK;

  const tokens = (n: number | undefined) => (Number.isFinite(n) && n! > 0 ? n! : 0);
  return (
    (tokens(usage?.inputTokens?.total) * price.input +
      tokens(usage?.outputTokens?.total) * price.output) /
    1_000_000
  );
}

/** `YYYY-MM-DD` del día UTC de `now`. */
export const utcDayISO = (now: Date): string => now.toISOString().slice(0, 10);

/** Primer día (UTC) del mes de `now`: desde ahí se leen las filas del mes. */
export const utcMonthStartISO = (now: Date): string => `${utcDayISO(now).slice(0, 7)}-01`;

const secondsUntil = (from: Date, to: number) =>
  Math.max(0, Math.ceil((to - from.getTime()) / 1000));

/**
 * Decide si la próxima llamada pasa. `rows` son las filas de `ai_spend` de la
 * persona desde el día 1 del mes; lo que no sea de este mes se ignora.
 *
 * Se comprueba ANTES de llamar, contra lo ya gastado, así que la llamada que
 * cruza el tope sí se hace: el exceso queda acotado a lo que cuesta una
 * operación (céntimos), a cambio de no tener que adivinar su coste por
 * adelantado. El mes va primero: si se han pasado los dos topes, esperar a
 * mañana no serviría de nada y el mensaje tiene que decir cuándo sí.
 */
export function decideSpendCap(
  rows: readonly AiSpendRow[],
  caps: AiSpendCaps,
  now: Date,
): SpendCapDecision {
  const today = utcDayISO(now);
  const month = today.slice(0, 7);

  let daySpentUsd = 0;
  let monthSpentUsd = 0;
  for (const row of rows) {
    const cost = Number(row.cost_usd);
    if (!Number.isFinite(cost) || cost <= 0 || row.day.slice(0, 7) !== month) continue;
    monthSpentUsd += cost;
    if (row.day === today) daySpentUsd += cost;
  }

  const spent = { daySpentUsd, monthSpentUsd };
  if (monthSpentUsd >= caps.monthlyUsd) {
    const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    return {
      ...spent,
      allowed: false,
      scope: "month",
      retryAfterSeconds: secondsUntil(now, nextMonth),
    };
  }
  if (daySpentUsd >= caps.dailyUsd) {
    const tomorrow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return {
      ...spent,
      allowed: false,
      scope: "day",
      retryAfterSeconds: secondsUntil(now, tomorrow),
    };
  }
  return { ...spent, allowed: true };
}

/**
 * Qué topes cortan una llamada. `day` (lo normal) = el diario y el mensual.
 * `month` = solo el mensual: lo usa la descomposición de platos (ticket 13 de
 * `precision-nutricional`, D13), porque dejar un plato sin calcular rompe la
 * promesa de que todo plato sale de su receta, cuesta céntimos, y sigue
 * sumando al gasto y contando en las cuotas por hora.
 */
export type SpendCapScope = "day" | "month";

/** ¿Esta decisión corta una llamada hecha con `capScope`? */
export function spendCapBlocks(decision: SpendCapDecision, capScope: SpendCapScope): boolean {
  if (decision.allowed) return false;
  return capScope === "day" || decision.scope === "month";
}
