import { Loader2 } from "lucide-react";
import { useState } from "react";

import type { PlanFitChange, PlanFitMark } from "@/lib/plan-shared";

/**
 * Lo que cambió la comprobación del plan contra el objetivo (ticket 10 de
 * `precision-nutricional`, `fitMonthlyPlan`), dentro de "Cómo enfocamos el mes".
 *
 * La ronda corre sola justo después de calcular los platos del mes y cambia
 * algunos: un cambio automático del plan tiene que verse, o parece que el plan
 * se mueve sin motivo. Cada cambio con el plato anterior tachado, como en
 * "Balance de hoy". Sin cifras: vale igual con `nutrition_numbers = ocultar`.
 * Copia en `mobile/components/plan-fit-note.tsx`.
 */

/** Cambios a la vista; el resto tras "Ver los N". */
const INLINE_CHANGES = 3;

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric" });

const SLOT_LABEL: Record<PlanFitChange["slot"], string> = {
  desayuno: "Desayuno",
  comida: "Comida",
  cena: "Cena",
  merienda: "Merienda",
};

/** "mar 15 · Cena", o para una idea de la semana "Merienda · 4 días desde mar 15". */
const changeLabel = (c: PlanFitChange) =>
  c.days && c.days > 1
    ? `${SLOT_LABEL[c.slot]} · ${c.days} días desde ${dayLabel(c.date)}`
    : `${dayLabel(c.date)} · ${SLOT_LABEL[c.slot]}`;

export function PlanFitNote({ fit, fitting }: { fit?: PlanFitMark; fitting: boolean }) {
  const [all, setAll] = useState(false);
  if (fitting && !fit) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Ajustando tus platos a tu objetivo…
      </p>
    );
  }
  if (!fit?.changed.length) return null;

  const n = fit.changed.length;
  const shown = all ? fit.changed : fit.changed.slice(0, INLINE_CHANGES);
  return (
    <div className="mt-4 border-t border-border/60 pt-4">
      <p className="text-sm font-medium">
        He cambiado {n} {n === 1 ? "plato" : "platos"} para que tus días lleguen a lo que necesitas
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Ajustando solo la cantidad no llegaban.
      </p>
      <div className="mt-3 space-y-2">
        {shown.map((c) => (
          <div key={`${c.date}-${c.slot}`} className="rounded-xl bg-secondary/60 px-3 py-2.5">
            <span className="font-num text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              {changeLabel(c)}
            </span>
            <div className="mt-1 flex items-start gap-1.5 text-[13px] leading-snug">
              <span className="text-muted-foreground line-through">{c.from}</span>
              <span className="shrink-0 text-muted-foreground">→</span>
              <span className="text-foreground">{c.to}</span>
            </div>
          </div>
        ))}
      </div>
      {n > INLINE_CHANGES ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-2 text-xs font-medium text-primary"
        >
          {all ? "Ver menos" : `Ver los ${n}`}
        </button>
      ) : null}
    </div>
  );
}
