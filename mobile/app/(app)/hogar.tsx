import { useQuery } from "@tanstack/react-query";
import { Copy, LogOut, Pencil, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { ChildSheet } from "../../components/child-sheet";
import { JoinOrCreateHousehold } from "../../components/hogar/join-or-create";
import { HouseholdRebuildCard } from "../../components/hogar/rebuild-card";
import { HouseholdRosterCard } from "../../components/hogar/roster-card";
import { HouseholdScheduleSection } from "../../components/hogar/schedule-section";
import { fetchMonthlyPlan, monthISO, todayISO } from "../../lib/daily";
import { fetchHousehold, type HouseholdChild } from "../../lib/household";
import { EMPTY_SCHEDULE, eatsTableFood } from "../../lib/household-shared";
import { childPureeGaps, type MonthlyPlan } from "../../lib/plan-shared";
import { useHouseholdMutations } from "../../lib/use-household-mutations";

export default function Hogar() {
  const { t } = useTranslation();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  // La mesa o los horarios cambiaron en esta visita: el plan del mes aún no
  // cuenta con ello hasta que quien planifica lo rehaga.
  const [tableChanged, setTableChanged] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [childSheet, setChildSheet] = useState<{ open: boolean; child: HouseholdChild | null }>({
    open: false,
    child: null,
  });

  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });

  const isCreator = state.data?.household?.created_by === state.data?.me?.user_id;
  const isPlanner = !!state.data?.me?.is_planner;
  const plannerName = state.data?.planner?.display_name ?? t("hogar.roster.plannerFallback");
  // Gestionar la mesa (añadir, renombrar, quitar, cambiar ración, ceder quién
  // planifica) lo puede hacer el creador o quien planifica ese hogar — así lo
  // permite ahora la policy de household_members (migración
  // 20260907120000_household_roster_planner_manages.sql). Antes solo miraba
  // isCreator: la base de datos ya dejaba pasar a un planificador que no fuera
  // el creador, pero el formulario seguía escondido.
  const canManageRoster = isCreator || isPlanner;

  // Un cambio en la mesa (entra/sale alguien, cambia una ración) invalida los
  // platos Y las cantidades del plan, pero ya no se rehace solo: lo pide quien
  // planifica con "Rehacer plan con la familia" (ver `rebuildPlanWithHousehold`).
  // Aquí solo se deja constancia para avisarle.
  const recalcRoster = () => setTableChanged(true);

  const {
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
    fillKids: fillKidsMut,
  } = useHouseholdMutations({
    householdId: state.data?.household?.id,
    month,
    onTableChanged: recalcRoster,
    onPlanRebuilt: () => setTableChanged(false),
  });

  const confirmLeave = () =>
    Alert.alert(t("hogar.leave.confirmTitle"), t("hogar.leave.confirmText"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("hogar.leave.confirm"), style: "destructive", onPress: () => leave.mutate() },
    ]);

  const shareCode = (inviteCode: string) =>
    void Share.share({
      message: t("hogar.code.shareMessage", { code: inviteCode }),
    }).catch(() => {
      /* el usuario canceló el diálogo */
    });

  const household = state.data?.household;
  const members = state.data?.members ?? [];
  const children = state.data?.children ?? [];
  // Los bebés que aún no comen de la mesa (la tarjeta los pinta en su grupo).
  const babies = children.filter((c) => !eatsTableFood(c.feeding_stage));
  // A un bebé de triturados recién dado de alta (o recién cambiado de etapa)
  // le falta su puré en el plan hasta que se regenera — `childPureeGaps` mira
  // de hoy en adelante. Dispara el aviso "Actualizar" bajo la lista.
  const today = todayISO();
  const householdBaseline = household?.shared_slots ?? EMPTY_SCHEDULE;
  const pendingKidMeals = babies.filter(
    (c) =>
      c.feeding_stage === "triturados" &&
      childPureeGaps(
        (planQ.data?.plan as MonthlyPlan | null) ?? null,
        { id: c.id, stage: c.feeding_stage, homeSchedule: c.home_schedule ?? householdBaseline },
        today,
      ).length > 0,
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-36 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        {!household ? (
          <>
            <JoinOrCreateHousehold create={create} lookup={lookup} claim={claim} />
          </>
        ) : (
          <>
            <View className="mt-2 flex-row items-start gap-2.5">
              <View className="flex-1">
                <Text className="text-[11px] font-sans-semibold uppercase tracking-widest text-muted-foreground">
                  {t("hogar.eyebrow")}
                </Text>
                {editingName ? (
                  <TextInput
                    key={`name-${household.id}`}
                    autoFocus
                    className="mt-0.5 rounded-xl bg-muted px-2 py-1 font-heading text-2xl text-foreground"
                    defaultValue={household.name}
                    placeholderTextColor="#a69d8f"
                    onEndEditing={(e) => {
                      renameHousehold(household.id, e.nativeEvent.text);
                      setEditingName(false);
                    }}
                  />
                ) : (
                  <Text className="mt-0.5 font-heading text-3xl text-foreground">
                    {household.name}
                  </Text>
                )}
              </View>
              {!editingName ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setEditingName(true)}
                  accessibilityLabel={t("hogar.rename")}
                  hitSlop={8}
                  className="mt-4 h-8 w-8 items-center justify-center rounded-full bg-secondary active:opacity-70"
                >
                  <Pencil size={15} color="#6b6256" />
                </Pressable>
              ) : null}
            </View>

            <View className="mt-4 flex-row items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3">
              <ShieldCheck size={16} color="#6dbe7b" style={{ marginTop: 1 }} />
              <Text className="flex-1 text-xs text-muted-foreground">
                {t("hogar.privacyShared")}
              </Text>
            </View>

            <View className="mt-4 gap-2.5 rounded-3xl bg-primary-soft p-5">
              <Text className="text-[11px] font-sans-semibold uppercase tracking-widest text-muted-foreground">
                {t("hogar.code.title")}
              </Text>
              <View className="flex-row items-center gap-3">
                <Text className="flex-1 font-heading text-3xl tracking-widest text-foreground">
                  {household.invite_code}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => shareCode(household.invite_code)}
                  className="flex-row items-center gap-2 rounded-full bg-surface px-4 py-3 active:opacity-80"
                >
                  <Copy size={16} color="#6b6256" />
                  <Text className="text-sm font-sans-medium text-foreground">
                    {t("hogar.code.share")}
                  </Text>
                </Pressable>
              </View>
              <Text className="text-xs leading-5 text-muted-foreground">
                {t("hogar.code.hint")}
              </Text>
            </View>

            <HouseholdRosterCard
              members={members}
              kids={children}
              meUserId={state.data?.me?.user_id}
              canManageRoster={canManageRoster}
              pendingKidNames={pendingKidMeals.map((c) => c.name)}
              addAdult={addAdult}
              fillKids={fillKidsMut}
              onOpenChild={(child) => setChildSheet({ open: true, child })}
              renameMember={renameMember}
              setMemberPortion={setMemberPortion}
              markUsesApp={markUsesApp}
              makePlanner={makePlanner}
              dropMember={dropMember}
            />

            <HouseholdScheduleSection
              members={members}
              kids={children}
              sharedSlots={household.shared_slots}
              meUserId={state.data?.me?.user_id}
              isPlanner={isPlanner}
              plannerName={plannerName}
              persistSchedule={persistSchedule}
            />

            {isPlanner && (members.length > 1 || children.length > 0) ? (
              <HouseholdRebuildCard
                tableChanged={tableChanged}
                hasPlan={!!planQ.data?.plan}
                rebuild={rebuild}
              />
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={confirmLeave}
              className="mt-6 flex-row items-center justify-center gap-2 rounded-full bg-surface py-4 active:opacity-80"
            >
              <LogOut size={16} color="#6b6256" />
              <Text className="text-sm font-sans-medium text-muted-foreground">
                {t("hogar.leave.submit")}
              </Text>
            </Pressable>

            <ChildSheet
              key={childSheet.child?.id ?? "new"}
              open={childSheet.open}
              child={childSheet.child}
              householdId={household.id}
              onClose={() => setChildSheet((s) => ({ ...s, open: false }))}
              onChanged={recalcRoster}
            />
          </>
        )}
      </ScrollView>

      <BottomNav />
    </SafeAreaView>
  );
}
