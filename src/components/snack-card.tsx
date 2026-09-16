import { Info, Loader2, X } from "lucide-react";

import { snackOutcomeNote, snackTotals, type DaySnacks } from "@/lib/snacks";

/**
 * "Picoteo de hoy" en Hoy (feature `picoteo-hoy`): lo apuntado, con sus kcal y
 * una X para quitarlo, y debajo qué ha pasado con el plan. Solo se pinta si hay
 * algo que enseñar. Copia en `mobile/components/snack-card.tsx`.
 */
export function SnackCard({
  snacks,
  settling,
  failed,
  removingId,
  onRemove,
  onShowAdjustment,
}: {
  snacks: DaySnacks | null;
  /** Hay un asentamiento pendiente o en vuelo. */
  settling: boolean;
  /** El último asentamiento falló. */
  failed: boolean;
  removingId: string | null;
  onRemove: (id: string) => void;
  onShowAdjustment: () => void;
}) {
  const entries = snacks?.entries ?? [];
  const adjustment = snacks?.adjustment;
  if (!entries.length && !adjustment?.changes.length) return null;

  const total = snackTotals(snacks).kcal;
  const note = snackOutcomeNote(snacks?.lastOutcome);
  const moved = adjustment?.changes.length ?? 0;

  return (
    <section className="animate-rise mt-6 rounded-[20px] bg-surface px-3.5 py-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11.5px] font-semibold tracking-[0.01em] text-foreground">
          Picoteo de hoy
        </h3>
        {entries.length ? (
          <span className="font-num text-[10.5px] tabular-nums text-muted-foreground">
            ~{total} kcal
          </span>
        ) : null}
      </div>

      {entries.length ? (
        <ul className="mt-2 space-y-1.5">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <span className="line-clamp-2 min-w-0 flex-1 text-[13px] text-foreground">
                {e.text}
              </span>
              <span className="font-num text-[11px] tabular-nums text-muted-foreground">
                {e.kcal} kcal
              </span>
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
      ) : null}

      {settling ? (
        <p className="mt-2.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden />
          Revisando tu plan…
        </p>
      ) : (
        <>
          {moved ? (
            <button
              type="button"
              onClick={onShowAdjustment}
              className="mt-2.5 flex items-center gap-1.5 text-left text-[11.5px] font-medium text-primary"
            >
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
              He ajustado {moved} {moved === 1 ? "comida" : "comidas"} para compensarlo · Ver
            </button>
          ) : null}
          {failed ? (
            <p className="mt-2.5 text-[11.5px] text-muted-foreground">
              No he podido revisar el plan ahora; lo intento de nuevo más tarde.
            </p>
          ) : note ? (
            <p className="mt-2.5 text-[11.5px] text-muted-foreground">{note}</p>
          ) : null}
        </>
      )}
    </section>
  );
}
