import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { useHouseholdMutations } from "@/lib/use-household-mutations";

type Mutations = ReturnType<typeof useHouseholdMutations>;

/**
 * «Rehacer plan con la familia»: lo pide quien planifica; un cambio en la mesa
 * ya no lo dispara solo, solo deja el aviso (`tableChanged`).
 */
export function HouseholdRebuildCard({
  tableChanged,
  hasPlan,
  rebuild,
}: {
  tableChanged: boolean;
  hasPlan: boolean;
  rebuild: Mutations["rebuild"];
}) {
  const { t } = useTranslation();
  return (
    <section className="surface-card mt-4 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <RefreshCw className="h-4 w-4 text-primary-ink" /> {t("hogar.rebuild.title")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("hogar.rebuild.intro")}</p>
      {tableChanged ? (
        <p className="mt-3 rounded-2xl bg-primary-soft px-4 py-3 text-xs text-primary-ink">
          {t("hogar.rebuild.changed")}
        </p>
      ) : null}
      <button
        onClick={() => rebuild.mutate()}
        disabled={rebuild.isPending || !hasPlan}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${rebuild.isPending ? "animate-spin" : ""}`} />
        {rebuild.isPending ? t("hogar.rebuild.running") : t("hogar.rebuild.submit")}
      </button>
      {rebuild.isPending ? (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {t("hogar.rebuild.wait")}
        </p>
      ) : !hasPlan ? (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          {t("hogar.rebuild.noPlan")}
        </p>
      ) : null}
    </section>
  );
}
