import { Loader2, X } from "lucide-react";

import { exerciseTotals, type DayExercise } from "@/lib/exercise";

/** "Dentro de tu rutina (2 de 3 esta semana) · ya está en tu plan" (ticket 16). */
const routineLine = (index?: number, of?: number) =>
  `Dentro de tu rutina${index && of ? ` (${index} de ${of} esta semana)` : ""} · ya está en tu plan`;

/**
 * "Deporte de hoy" en Hoy: lo apuntado, con sus kcal quemadas y una X para
 * quitarlo. Una sesión de su rutina dice que ya va en el plan: solo cuenta lo
 * que pase de ella.
 *
 * Solo la lista, por el mismo motivo que `snack-card.tsx`: qué ha pasado con el
 * plan lo cuenta `DayBalanceCard`, con el desvío del día entero.
 */
export function ExerciseCard({
  exercise,
  removingId,
  onRemove,
  showNumbers = true,
}: {
  exercise: DayExercise | null;
  removingId: string | null;
  onRemove: (id: string) => void;
  /** `false` con la preferencia de no ver cifras (ticket 01): solo la lista. */
  showNumbers?: boolean;
}) {
  const entries = exercise?.entries ?? [];
  if (!entries.length) return null;

  // Solo lo que desvía el día: la parte de rutina ya va en el objetivo (ticket 16).
  const total = -exerciseTotals(exercise);
  const anyRoutine = entries.some((e) => e.routine);

  return (
    <section className="animate-rise mt-6 rounded-[20px] bg-surface px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11.5px] font-semibold tracking-[0.01em] text-foreground">
          Deporte de hoy
        </h3>
        {showNumbers ? (
          <span className="font-num text-[10.5px] tabular-nums text-muted-foreground">
            ~{total} kcal{anyRoutine ? " extra" : ""}
          </span>
        ) : null}
      </div>

      <ul className="mt-2 space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[13px] text-foreground">
                {e.activity} · {e.minutes} min · {e.intensity.toLowerCase()}
              </span>
              {e.routine ? (
                <span className="block text-[11px] text-muted-foreground">
                  {routineLine(e.routineIndex, e.routineOf)}
                  {showNumbers && e.kcal < 0 ? ` · ${-e.kcal} kcal extra` : ""}
                </span>
              ) : null}
            </span>
            {showNumbers && !e.routine ? (
              <span className="font-num text-[11px] tabular-nums text-muted-foreground">
                {-e.kcal} kcal
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(e.id)}
              disabled={removingId != null}
              aria-label={`Quitar ${e.activity}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground transition-opacity hover:text-foreground disabled:opacity-60"
            >
              {removingId === e.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <X className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
