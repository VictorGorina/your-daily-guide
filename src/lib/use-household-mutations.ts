import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { monthISO, todayISO } from "@/lib/daily";
import {
  addAdultSlot,
  claimSlot,
  createHousehold,
  leaveHousehold,
  openSlots,
  removeMember,
  renameHousehold as renameHouseholdRow,
  setPlanner,
  updateMember,
} from "@/lib/household";
import { saveHomeSchedule, syncHouseholdPlan } from "@/lib/household.functions";
import type { HomeSchedule } from "@/lib/household-shared";
import { rebuildPlanWithHousehold } from "@/lib/plan-recalc";
import { fillChildMeals } from "@/lib/plan.functions";

/**
 * Todas las escrituras de la pantalla Familia, cada una con su aviso y su
 * invalidación (ticket 28 de la auditoría; copia de `mobile/lib/`, con `toast`
 * en vez de `Alert`). Lo que es estado de la pantalla (el formulario, el código
 * tecleado) se queda en ella: aquí entra como variable de la mutación y se
 * limpia con el `onSuccess` de `mutate`.
 *
 * `onTableChanged` avisa de que la mesa o los horarios ya no coinciden con el
 * plan del mes; `onPlanRebuilt`, de que el plan se ha rehecho con la mesa.
 */
export function useHouseholdMutations({
  householdId,
  month,
  onTableChanged,
  onPlanRebuilt,
}: {
  householdId: string | undefined;
  month: string;
  onTableChanged: () => void;
  onPlanRebuilt: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sync = useServerFn(syncHouseholdPlan);
  const saveSched = useServerFn(saveHomeSchedule);
  const fillChildMealsFn = useServerFn(fillChildMeals);
  const refresh = () => qc.invalidateQueries({ queryKey: ["household"] });

  const create = useMutation({
    mutationFn: (name: string) => createHousehold(name),
    onSuccess: () => {
      toast.success(t("hogar.create.done"));
      refresh();
    },
    onError: () => toast.error(t("hogar.create.failed")),
  });

  const lookup = useMutation({
    mutationFn: (code: string) => openSlots(code),
    // La búsqueda cuenta los códigos malos: al llegar al límite, que lo diga.
    onError: (e: Error) =>
      toast.error(e.message.includes("Demasiados") ? e.message : t("hogar.join.lookupFailed")),
  });

  const claim = useMutation({
    mutationFn: ({ code, memberId }: { code: string; memberId: string }) =>
      claimSlot(code, memberId),
    onSuccess: () => {
      toast.success(t("hogar.join.joined"));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addAdult = useMutation({
    mutationFn: (adult: { name: string; usesApp: boolean; portion: number }) => {
      if (!householdId) throw new Error(t("hogar.roster.noHousehold"));
      return addAdultSlot(householdId, {
        display_name: adult.name.trim(),
        uses_app: adult.usesApp,
        portion: adult.portion,
      });
    },
    onSuccess: () => {
      toast.success(t("hogar.add.added"));
      refresh();
      onTableChanged();
    },
    // Antes se descartaba el error real y siempre salía el mismo texto
    // genérico, así que un fallo (RLS, validación, lo que fuera) no se podía
    // diagnosticar ni por el usuario ni por nosotros.
    onError: (e: Error) => toast.error(e.message),
  });

  const markUsesApp = useMutation({
    mutationFn: (id: string) => updateMember(id, { uses_app: true }),
    onSuccess: refresh,
  });

  const dropMember = useMutation({
    mutationFn: (id: string) => removeMember(id),
    onSuccess: () => {
      refresh();
      onTableChanged();
    },
  });

  const makePlanner = useMutation({
    mutationFn: (id: string) => {
      if (!householdId) throw new Error(t("hogar.roster.noHousehold"));
      return setPlanner(householdId, id);
    },
    onSuccess: () => {
      toast.success(t("hogar.roster.plannerChanged"));
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameMember = (id: string, value: string) =>
    void updateMember(id, { display_name: value.trim() || t("hogar.roster.memberFallback") }).then(
      refresh,
    );
  const setMemberPortion = (id: string, portion: number) =>
    void updateMember(id, { portion }).then(() => {
      refresh();
      onTableChanged();
    });
  const renameHousehold = (id: string, value: string) =>
    void renameHouseholdRow(id, value).then(refresh);

  const leave = useMutation({
    mutationFn: leaveHousehold,
    onSuccess: () => {
      toast.success(t("hogar.leave.done"));
      refresh();
    },
  });

  const persistSchedule = useMutation({
    mutationFn: async (opts: { memberId?: string; childId?: string; schedule: HomeSchedule }) => {
      await saveSched({ data: opts });
      // Sync plan after schedule change
      await sync({ data: { month: monthISO(), today: todayISO() } });
    },
    onSuccess: () => {
      toast.success(t("hogar.schedule.saved"));
      refresh();
      onTableChanged();
      qc.invalidateQueries({ queryKey: ["plan", monthISO()] });
    },
    onError: (e: Error) => toast.error(e.message || t("hogar.schedule.saveFailed")),
  });

  // Regenera platos y cantidades con la mesa actual y copia las comidas
  // compartidas a quien tiene la app; quien no la tiene solo cuenta como
  // raciones. Tarda lo que una generación (~1-2 min).
  const rebuild = useMutation({
    mutationFn: () => rebuildPlanWithHousehold(month, todayISO()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      if (r?.skipped === "no-plan") {
        toast(t("hogar.rebuild.noPlanToast"));
        return;
      }
      onPlanRebuilt();
      toast.success(t(r?.synced ? "hogar.rebuild.doneSynced" : "hogar.rebuild.done"));
    },
    onError: (e: Error) => {
      console.warn("hogar: rehaciendo el plan con la familia", e);
      toast.error(t("hogar.rebuild.failed"));
    },
  });

  // Rellena en el plan el puré que le falta a un bebé recién dado de alta.
  const fillKids = useMutation({
    mutationFn: () => fillChildMealsFn({ data: { today: todayISO() } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      toast.success(
        res.filled
          ? t("hogar.child.menuUpdated", { names: res.children.join(", ") })
          : t("hogar.child.upToDate"),
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("hogar.child.menuFailed")),
  });

  return {
    create,
    lookup,
    claim,
    addAdult,
    markUsesApp,
    dropMember,
    makePlanner,
    renameMember,
    setMemberPortion,
    renameHousehold,
    leave,
    persistSchedule,
    rebuild,
    fillKids,
  };
}
