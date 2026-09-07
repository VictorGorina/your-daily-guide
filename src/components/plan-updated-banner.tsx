import { X } from "lucide-react";

/**
 * Aviso: la mesa del hogar ha cambiado (entró o salió alguien, cambió una
 * ración, una alergia o una etapa) y el recálculo automático ya ha rehecho el
 * plan y, sobre todo, las CANTIDADES de la compra.
 *
 * No es un paso de confirmación —el recálculo se hace solo, por decisión de
 * producto— sino la constancia de que ha pasado: quien añade a alguien en
 * Familia no ve nada, y luego se encuentra la lista con otros números. Aparece
 * cuando el recálculo TERMINA (`hasPlanUpdatedNotice`, plan-recalc.ts) y se
 * queda hasta que se descarta, para que no dependa de estar mirando.
 */
export function PlanUpdatedBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 rounded-[16px] bg-warning/15 px-3.5 py-3">
      <p className="min-w-0 text-[12.5px] leading-snug text-foreground">
        <span className="font-medium">La mesa ha cambiado.</span> Hemos actualizado tu plan y las
        cantidades de la compra.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Descartar aviso"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition-transform active:scale-95"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
