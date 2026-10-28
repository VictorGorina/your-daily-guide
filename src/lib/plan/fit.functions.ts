import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ValidationError } from "@/lib/validation-error";
import { clampClientToday } from "@/lib/zoned-date";
import { createServerFn } from "@tanstack/react-start";
import { enqueueOrRun } from "./enqueue.server";
import { runFitMonthlyPlan } from "./fit-run.server";

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
 *
 * En el mismo trabajo, también una vez por plan (marca `plan.shoppingCheck`),
 * la compra se comprueba contra los platos: lo que falte se añade a las compras
 * que aún no se han hecho, y cada compra pasa a llevar lo de sus días
 * (`coverage.server.ts`). Por eso la lanza también un plan ya ajustado.
 *
 * Devuelve las dos marcas. Ruta espejo: `POST /api/v1/plan/fit`.
 */
export const fitMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; today?: string; async?: boolean }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const today = clampClientToday(input?.today);
    return { month: input.month, today, async: input?.async === true };
  })
  .handler(({ data: { async: queued, ...data }, context }) =>
    enqueueOrRun({
      queued,
      userId: context.userId,
      kind: "plan_fit",
      input: data,
      run: () => runFitMonthlyPlan(context, data),
    }),
  );
