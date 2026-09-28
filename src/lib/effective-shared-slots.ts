import {
  deriveSharedSlots,
  type FeedingStage,
  type HomeSchedule,
  type SharedSlots,
} from "./household-shared";

/**
 * Qué comidas de qué día comparte la mesa, con la regla ÚNICA que usan el
 * servidor (`householdContext`) y las pantallas (`fetchMonthlyPlan`, Hoy,
 * Plan). Idéntico byte a byte en mobile/lib/ (lo vigila
 * scripts/check-shared-drift.sh): que cliente y servidor calcularan esto cada
 * uno a su manera hizo que quien no planifica viera el plato del planificador
 * un día que había marcado «no como en casa».
 *
 * - Desde el 05-09 se deriva de los horarios de cada persona
 *   (`deriveSharedSlots`: el planificador en casa y al menos otra persona).
 * - Quien no ha puesto su horario hereda `legacy` (`households.shared_slots`),
 *   no «nunca en casa»: si no, un solo horario a medias vaciaría la mesa.
 * - Si nadie del hogar, niños incluidos, tiene horario, `legacy` tal cual.
 */
export function effectiveSharedSlots(
  legacy: SharedSlots,
  members: { isPlanner?: boolean; homeSchedule: HomeSchedule | null }[],
  children: { homeSchedule: HomeSchedule | null; stage?: FeedingStage }[],
): SharedSlots {
  const hasAnySchedule =
    members.some((m) => m.homeSchedule != null) || children.some((c) => c.homeSchedule != null);
  if (!hasAnySchedule) return legacy;
  return deriveSharedSlots(
    members.map((m) => ({ isPlanner: m.isPlanner, homeSchedule: m.homeSchedule ?? legacy })),
    children.map((c) => ({ homeSchedule: c.homeSchedule ?? legacy, stage: c.stage })),
  );
}
