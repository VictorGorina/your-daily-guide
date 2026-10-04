import type { DbClient } from "@/integrations/supabase/db-client";
import type { TablesUpdate } from "@/integrations/supabase/types";

import { logEvent } from "@/lib/log.server";
import { UserFacingError } from "@/lib/validation-error";

/**
 * Escrituras de la fila `monthly_plans` de un mes sin pisar lo que otro haya
 * escrito mientras tanto (ticket 21 de la auditoría, PERF-01/02).
 *
 * Varios caminos leen el plan, pasan 10-100 s con la IA y escriben el plan
 * entero: si entretanto la persona fija un plato a mano o marca algo en la
 * compra, una escritura ciega lo deshace. Aquí se escribe con CAS sobre
 * `updated_at` (lo mueve el trigger `monthly_plans_updated_at` en cada update),
 * el mismo patrón que `updateDailyLogCas` usa en `daily_logs`: leer la fila,
 * reconstruir el cambio sobre lo leído y escribir con
 * `.eq("updated_at", leído)`. Si no cambia ninguna fila, alguien escribió
 * antes: se relee y se reconstruye sobre la versión nueva.
 *
 * El trabajo caro (la IA) no se repite: `rebuild` solo vuelve a aplicar su
 * resultado, con las funciones que ya respetan lo fijado (`applyPlanChanges`,
 * `mergeFuturePlan`, `withPlanMeal`…).
 */

export type PlanRowCas = { updated_at: string } & Record<string, unknown>;
/** Lo que se escribe en la fila del mes: solo columnas que existen en `monthly_plans`. */
export type PlanRowPatch = TablesUpdate<"monthly_plans">;

/**
 * Cinco intentos con una pausa aleatoria corta entre ellos. Con tres y sin
 * pausa, cuatro escritores de verdad simultáneos sobre el mismo mes (una marca
 * de la compra, un extra y una recolocación compiten por la FILA, no por la
 * columna) llegaban a agotarlos: 3 de 8 en una prueba forzada. La pausa
 * desincroniza a los que chocaron en el mismo instante (ticket 21).
 */
export const PLAN_CAS_ATTEMPTS = 5;
export const CAS_RETRY_PAUSE_MS = { min: 20, max: 80 } as const;

const retryPause = () =>
  new Promise((resolve) =>
    setTimeout(
      resolve,
      CAS_RETRY_PAUSE_MS.min + Math.random() * (CAS_RETRY_PAUSE_MS.max - CAS_RETRY_PAUSE_MS.min),
    ),
  );

export const PLAN_CAS_EXHAUSTED_MESSAGE =
  "El plan ha cambiado mientras lo recalculábamos. Vuelve a intentarlo.";

/**
 * Escribe la fila del mes solo si nadie la ha cambiado desde que se leyó.
 * `rebuild` recibe la versión más reciente (con las `columns` pedidas y
 * `updated_at`) y devuelve el `patch`, o `null` para no escribir nada. Hasta
 * `PLAN_CAS_ATTEMPTS` intentos; después lanza `PLAN_CAS_EXHAUSTED_MESSAGE`.
 *
 * Sin fila no hay nada que actualizar: devuelve `{ patch: null, latest: null }`,
 * igual que un `update` sin coincidencias de antes.
 *
 * `client` es el de sesión o `supabaseAdmin`: quien llama decide, como antes.
 */
export async function updatePlanRowCas<Row extends PlanRowCas = PlanRowCas>(
  client: DbClient,
  userId: string,
  month: string,
  columns: string,
  rebuild: (latest: Row) => PlanRowPatch | null,
): Promise<{ patch: PlanRowPatch | null; latest: Row | null; attempts: number }> {
  const select = /\bupdated_at\b/.test(columns) ? columns : `${columns}, updated_at`;
  for (let attempt = 1; attempt <= PLAN_CAS_ATTEMPTS; attempt++) {
    if (attempt > 1) await retryPause();
    const { data, error: readError } = await client
      .from("monthly_plans")
      .select(select)
      .eq("user_id", userId)
      .eq("month", month)
      .maybeSingle();
    if (readError) throw readError;
    if (!data) return { patch: null, latest: null, attempts: attempt };
    const latest = data as unknown as Row;

    const patch = rebuild(latest);
    if (!patch) return { patch: null, latest, attempts: attempt };

    const { data: written, error } = await client
      .from("monthly_plans")
      .update(patch)
      .eq("user_id", userId)
      .eq("month", month)
      .eq("updated_at", latest.updated_at)
      .select("updated_at");
    if (error) throw error;
    if (written?.length) return { patch, latest, attempts: attempt };
  }
  logEvent("warn", "plan_cas_exhausted", { month });
  throw new UserFacingError(PLAN_CAS_EXHAUSTED_MESSAGE);
}
