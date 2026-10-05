import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Aviso: a uno o más peques de triturados les falta su puré en el plan de hoy
 * — pasa cuando se da de alta o se cambia de etapa a un bebé DESPUÉS de que el
 * plan del mes ya estaba generado (`childPureeGaps`, `plan-shared.ts`).
 * "Actualizar" llama a `fillChildMeals`, que solo AÑADE lo que falta: el plato
 * de la mesa y el resto del plan no se tocan.
 */
export function ChildMealGapBanner({
  names,
  pending,
  onUpdate,
}: {
  names: string[];
  pending: boolean;
  onUpdate: () => void;
}) {
  const { t } = useTranslation();
  if (!names.length) return null;
  const label =
    names.length === 1
      ? names[0]
      : t("common.listAnd", {
          rest: names.slice(0, -1).join(", "),
          last: names[names.length - 1],
        });

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-[16px] bg-warning/15 px-3.5 py-3">
      <p className="min-w-0 text-[12.5px] leading-snug text-foreground">
        {t("childGap.missing", { names: label })}
      </p>
      <button
        type="button"
        onClick={onUpdate}
        disabled={pending}
        className="flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3.5 py-2 text-[12px] font-medium text-background transition-transform active:scale-95 disabled:opacity-60"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {pending ? t("childGap.updating") : t("childGap.update")}
      </button>
    </div>
  );
}
