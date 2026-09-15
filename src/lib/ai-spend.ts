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
 * Precio de `COACH_MODEL` (Gemini 2.5 Flash) en OpenRouter, en $ por millón de
 * tokens. Solo se usa si una respuesta llega sin `usage.cost`: mejor contar una
 * estimación que dejar esa llamada fuera del tope. Si cambia el modelo, cambia
 * esto también.
 */
export const COACH_MODEL_USD_PER_MTOK = { input: 0.3, output: 2.5 } as const;

/** Lo que miramos de un resultado del modelo: sirve igual para `doGenerate`
 *  que para la parte `finish` de un stream. */
export type CallUsage = {
  usage?: { inputTokens?: { total?: number }; outputTokens?: { total?: number } };
  providerMetadata?: Record<string, unknown>;
};

/**
 * Coste en dólares de una llamada. Manda lo que factura OpenRouter
 * (`providerMetadata.openrouter.usage.cost`, que solo llega con
 * `usage: { include: true }`); si no viene, se estima con los tokens.
 */
export function callCostUsd({ usage, providerMetadata }: CallUsage): number {
  const openrouter = providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined;
  const reported = openrouter?.usage?.cost;
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return reported;
  }

  const tokens = (n: number | undefined) => (Number.isFinite(n) && n! > 0 ? n! : 0);
  return (
    (tokens(usage?.inputTokens?.total) * COACH_MODEL_USD_PER_MTOK.input +
      tokens(usage?.outputTokens?.total) * COACH_MODEL_USD_PER_MTOK.output) /
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
