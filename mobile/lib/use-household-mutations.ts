import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import { apiPost } from "./api";
import { monthISO, todayISO } from "./daily";
import {
  addAdultSlot,
  claimSlot,
  createHousehold,
  leaveHousehold,
  openSlots,
  removeMember,
  renameHousehold as renameHouseholdRow,
  saveHomeSchedule,
  setPlanner,
  updateMember,
} from "./household";
import type { HomeSchedule } from "./household-shared";
import { rebuildPlanWithHousehold } from "./plan-recalc";
import type { MonthlyPlan } from "./plan-shared";

// La sincronización del plan compartido toca el plan del otro miembro con la
// clave de servicio, así que va por /api/v1/* como en la web (el resto del CRUD
// del hogar es directo a Supabase).
const syncSharedPlan = () =>
  apiPost<{ synced: number }>("household/sync", { month: monthISO(), today: todayISO() });

/**
 * Todas las escrituras de la pantalla Familia, cada una con su aviso y su
 * invalidación (ticket 28 de la auditoría). Lo que es estado de la pantalla
 * (el formulario, el código tecleado) se queda en ella: aquí entra como
 * variable de la mutación y se limpia con el `onSuccess` de `mutate`.
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
  const refresh = () => qc.invalidateQueries({ queryKey: ["household"] });

  const create = useMutation({
    mutationFn: (name: string) => createHousehold(name),
    onSuccess: () => {
      Alert.alert(t("hogar.create.done"));
      refresh();
    },
    onError: () => Alert.alert(t("hogar.create.failed")),
  });

  const lookup = useMutation({
    mutationFn: (code: string) => openSlots(code),
    // La búsqueda cuenta los códigos malos: al llegar al límite, que lo diga.
    onError: (e: Error) =>
      Alert.alert(e.message.includes("Demasiados") ? e.message : t("hogar.join.lookupFailed")),
  });

  const claim = useMutation({
    mutationFn: ({ code, memberId }: { code: string; memberId: string }) =>
      claimSlot(code, memberId),
    onSuccess: () => {
      Alert.alert(t("hogar.join.joined"));
      refresh();
    },
    onError: (e: Error) => Alert.alert(e.message),
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
      Alert.alert(t("hogar.add.added"));
      refresh();
      onTableChanged();
    },
    // Antes se descartaba el error real y siempre salía el mismo texto
    // genérico, así que un fallo (RLS, validación, lo que fuera) no se podía
    // diagnosticar ni por el usuario ni por nosotros.
    onError: (e: Error) => Alert.alert(e.message),
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
      Alert.alert(t("hogar.roster.plannerChanged"));
      refresh();
    },
    onError: (e: Error) => Alert.alert(e.message),
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
      Alert.alert(t("hogar.leave.done"));
      refresh();
    },
  });

  const persistSchedule = useMutation({
    mutationFn: async (opts: { memberId?: string; childId?: string; schedule: HomeSchedule }) => {
      await saveHomeSchedule(opts);
      await syncSharedPlan();
    },
    onSuccess: () => {
      Alert.alert(t("hogar.schedule.saved"));
      refresh();
      onTableChanged();
      qc.invalidateQueries({ queryKey: ["plan", month] });
    },
    onError: (e: Error) => Alert.alert(e.message || t("hogar.schedule.saveFailed")),
  });

  // Regenera platos y cantidades con la mesa actual y copia las comidas
  // compartidas a quien tiene la app; quien no la tiene solo cuenta como
  // raciones. Tarda lo que una generación (~1-2 min).
  const rebuild = useMutation({
    mutationFn: () => rebuildPlanWithHousehold(month, todayISO()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      if (r?.skipped === "no-plan") {
        Alert.alert(t("hogar.rebuild.noPlanToast"));
        return;
      }
      onPlanRebuilt();
      Alert.alert(t(r?.synced ? "hogar.rebuild.doneSynced" : "hogar.rebuild.done"));
    },
    onError: (e: Error) => {
      console.warn("hogar: rehaciendo el plan con la familia", e);
      Alert.alert(t("hogar.rebuild.failed"));
    },
  });

  // Rellena en el plan el puré que le falta a un bebé recién dado de alta.
  const fillKids = useMutation({
    mutationFn: () =>
      apiPost<{ plan: MonthlyPlan; filled: number; children: string[] }>("plan/child-meal-fill", {
        today: todayISO(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      Alert.alert(
        res.filled
          ? t("hogar.child.menuUpdated", { names: res.children.join(", ") })
          : t("hogar.child.upToDate"),
      );
    },
    onError: (e) => Alert.alert(e instanceof Error ? e.message : t("hogar.child.menuFailed")),
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
