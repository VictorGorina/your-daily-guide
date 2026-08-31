import type { MacroEstimate } from "@/lib/guide.functions";
import { macroTargets } from "@/lib/macros";

const MACRO_BAR_ITEMS = [
  { key: "protein_g", label: "prot", color: "var(--color-chart-1)" },
  { key: "carbs_g", label: "carb", color: "var(--color-chart-2)" },
  { key: "fat_g", label: "gras", color: "var(--color-chart-3)" },
  { key: "fiber_g", label: "fibra", color: "var(--color-chart-4)" },
] as const;

/**
 * `target` es el `macroEstimate` del día (calculado por el coach a partir de
 * los platos reales de ese día) cuando ya existe; si un plato cambia a mano el
 * coach lo recalcula. Solo cae a la referencia genérica de peso (`macroTargets`)
 * mientras aún no hay guía. El porcentaje NO se recorta a 100: si ya comiste de
 * más, la barra se queda llena pero el número de al lado enseña el exceso
 * (p. ej. "132 g · 118%"); ese número solo se muestra cuando el objetivo es el
 * real del día, no la referencia genérica.
 *
 * Compartido por la pestaña Hoy y el detalle de un día pasado en Plan.
 */
export function MacroBars({
  estimate,
  target,
  weightKg,
  note,
}: {
  estimate: MacroEstimate;
  target: MacroEstimate | null;
  weightKg: number | null;
  /** Frase bajo la barra. Por defecto, la de Hoy (en curso); el detalle de un
   * día pasado pasa una en pasado. */
  note?: string;
}) {
  const fallbackTargets = macroTargets(weightKg);
  return (
    <section className="animate-rise mt-[22px]">
      <div className="grid grid-cols-4 gap-2.5">
        {MACRO_BAR_ITEMS.map((it) => {
          const value = estimate[it.key];
          const goal = target?.[it.key] || fallbackTargets[it.key];
          const pct = goal > 0 ? Math.round((value / goal) * 100) : 0;
          const width = Math.min(100, pct);
          return (
            <div key={it.key} className="min-w-0">
              <div className="h-[5px] overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full transition-[width] duration-1000 ease-out"
                  style={{ width: `${width}%`, backgroundColor: it.color }}
                />
              </div>
              <p className="mt-[7px] truncate font-num text-[9.5px] font-medium uppercase leading-none tracking-[0.06em] text-muted-foreground">
                {it.label}
              </p>
              <p className="mt-[3px] font-num text-[11px] font-medium leading-none tabular-nums text-foreground">
                {value} g{target ? ` · ${pct}%` : ""}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
        {note ?? `~${estimate.kcal} kcal de lo que llevas comido hoy`}: estimación orientativa, no
        un conteo nutricional exacto.
      </p>
    </section>
  );
}
