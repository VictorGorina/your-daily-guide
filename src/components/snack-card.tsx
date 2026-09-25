import { Loader2, X } from "lucide-react";

import { snackTotals, type DaySnacks } from "@/lib/snacks";

/**
 * "Picoteo de hoy" en Hoy: lo apuntado, con sus kcal y una X para quitarlo.
 *
 * Solo la lista. Qué ha pasado con el plan lo cuenta `DayBalanceCard`, porque
 * el desvío que mueve los días futuros es el del día entero y no el del
 * picoteo: esta tarjeta decía "he recolocado N comidas" al mismo tiempo que la
 * del deporte decía lo suyo, las dos sobre el mismo reajuste (feature
 * `balance-del-dia`). Mismo formato que `exercise-card.tsx`.
 */
export function SnackCard({
  snacks,
  removingId,
  onRemove,
  showNumbers = true,
}: {
  snacks: DaySnacks | null;
  removingId: string | null;
  onRemove: (id: string) => void;
  /** `false` con la preferencia de no ver cifras (ticket 01): solo la lista. */
  showNumbers?: boolean;
}) {
  const entries = snacks?.entries ?? [];
  if (!entries.length) return null;

  const total = Math.round(snackTotals(snacks).kcal);

  return (
    <section className="animate-rise mt-6 rounded-[20px] bg-surface px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11.5px] font-semibold tracking-[0.01em] text-foreground">
          Picoteo de hoy
        </h3>
        {showNumbers ? (
          <span className="font-num text-[10.5px] tabular-nums text-muted-foreground">
            ~{total} kcal
          </span>
        ) : null}
      </div>

      <ul className="mt-2 space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="flex items-center gap-2">
            <span className="line-clamp-2 min-w-0 flex-1 text-[13px] text-foreground">
              {e.text}
            </span>
            {showNumbers ? (
              <span className="font-num text-[11px] tabular-nums text-muted-foreground">
                {e.kcal} kcal
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => onRemove(e.id)}
              disabled={removingId != null}
              aria-label={`Quitar ${e.text}`}
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
