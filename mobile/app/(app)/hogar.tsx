import { useQuery } from "@tanstack/react-query";
import {
  Baby,
  ChevronRight,
  ChefHat,
  Copy,
  LogOut,
  Pencil,
  ShieldCheck,
  UserPlus,
} from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { ChildMealGapBanner } from "../../components/child-meal-gap-banner";
import { ChildSheet } from "../../components/child-sheet";
import { JoinOrCreateHousehold } from "../../components/hogar/join-or-create";
import { HouseholdRebuildCard } from "../../components/hogar/rebuild-card";
import { HouseholdScheduleSection } from "../../components/hogar/schedule-section";
import { fetchMonthlyPlan, monthISO, todayISO } from "../../lib/daily";
import { fetchHousehold, type HouseholdChild } from "../../lib/household";
import {
  EMPTY_SCHEDULE,
  eatsTableFood,
  personColor,
  type Appetite,
} from "../../lib/household-shared";
import { childPureeGaps, type MonthlyPlan } from "../../lib/plan-shared";
import { useHouseholdMutations } from "../../lib/use-household-mutations";

const INPUT = "h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground";

/**
 * Apetito → peso de ración para dimensionar la compra (adultos; los niños usan
 * `childPortion`). La etiqueta sale del catálogo (`appetite.<clave>`).
 */
const APPETITES: readonly [Appetite, number][] = [
  ["poco", 0.8],
  ["normal", 1],
  ["mucho", 1.2],
];
const portionFor = (a: Appetite) => APPETITES.find(([key]) => key === a)![1];

export default function Hogar() {
  const { t } = useTranslation();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  const [addingType, setAddingType] = useState<"adult" | "child">("adult");
  const [newAdult, setNewAdult] = useState<{ name: string; usesApp: boolean; appetite: Appetite }>({
    name: "",
    usesApp: true,
    appetite: "normal",
  });
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
  // Los bebés que aún no comen de la mesa van en su propio grupo.
  const tableKids = children.filter((c) => eatsTableFood(c.feeding_stage));
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
  const renderChildRow = (c: HouseholdChild) => {
    const pal = personColor(c.id);
    // Quien aún no come de la mesa enseña su etapa en vez de alergias y apetito.
    const note = eatsTableFood(c.feeding_stage)
      ? ""
      : t(`hogar.child.stageNote.${c.feeding_stage}`);
    return (
      <Pressable
        accessibilityRole="button"
        key={c.id}
        onPress={() => setChildSheet({ open: true, child: c })}
        className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3 active:opacity-80"
      >
        <View
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: pal.soft }}
        >
          <Baby size={20} color={pal.ink} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-sans-medium text-foreground">
            {c.name}
            {c.age ? ` · ${t("hogar.child.age", { count: c.age })}` : ""}
          </Text>
          <Text className="mt-0.5 text-xs text-muted-foreground">
            {note
              ? note
              : t("hogar.child.summary", {
                  allergies: c.allergies
                    ? t("hogar.child.allergies", { list: c.allergies.toLowerCase() })
                    : t("hogar.child.noAllergies"),
                  appetite: t(`appetite.lower.${c.appetite ?? "normal"}`, {
                    defaultValue: c.appetite ?? "normal",
                  }),
                })}
          </Text>
        </View>
        <ChevronRight size={18} color="#6b6256" />
      </Pressable>
    );
  };

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

            <View className="mt-4 rounded-3xl bg-surface p-5">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-sans-semibold text-foreground">
                  {t("hogar.roster.title")}
                </Text>
                <Text className="text-[11px] text-muted-foreground">
                  {t("hogar.roster.count", { count: members.length + children.length })}
                </Text>
              </View>

              {/* --- Lista unificada: adultos primero, luego peques --- */}
              <View className="mt-4 gap-2">
                {members.map((m) => {
                  const isMe = !!m.user_id && m.user_id === state.data?.me?.user_id;
                  const initial = (m.display_name.trim()[0] ?? "?").toUpperCase();
                  const pal = personColor(m.id);
                  return (
                    <View key={m.id} className="rounded-2xl bg-secondary px-4 py-3">
                      <View className="flex-row items-center gap-3">
                        <View
                          className="h-10 w-10 items-center justify-center rounded-full"
                          style={{ backgroundColor: pal.soft }}
                        >
                          <Text className="font-heading text-[15px]" style={{ color: pal.ink }}>
                            {initial}
                          </Text>
                        </View>
                        {canManageRoster && !isMe ? (
                          <TextInput
                            className="flex-1 rounded-lg bg-muted px-2 py-1 text-sm text-foreground"
                            defaultValue={m.display_name}
                            placeholderTextColor="#a69d8f"
                            onEndEditing={(e) => renameMember(m.id, e.nativeEvent.text)}
                          />
                        ) : (
                          <Text className="flex-1 text-sm font-sans-medium text-foreground">
                            {m.display_name}
                          </Text>
                        )}
                        <View className="flex-row items-center gap-1">
                          {m.is_planner ? (
                            <View className="flex-row items-center gap-1 rounded-full bg-primary-soft px-2 py-1">
                              <ChefHat size={12} color="#6dbe7b" />
                              <Text className="text-[11px] font-sans-medium text-primary-ink">
                                {t("hogar.roster.planner")}
                              </Text>
                            </View>
                          ) : null}
                          {isMe ? (
                            <Text className="rounded-full bg-surface px-2 py-1 text-[11px] font-sans-medium text-muted-foreground">
                              {t("hogar.roster.you")}
                            </Text>
                          ) : !m.uses_app ? (
                            <Text className="rounded-full bg-surface px-2 py-1 text-[11px] font-sans-medium text-muted-foreground">
                              {t("hogar.roster.noAccount")}
                            </Text>
                          ) : !m.user_id ? (
                            <Text className="rounded-full bg-surface px-2 py-1 text-[11px] font-sans-medium text-muted-foreground">
                              {t("hogar.roster.pending")}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
                        <Text className="text-[11px] text-muted-foreground">
                          {t("hogar.roster.portion")}
                        </Text>
                        {APPETITES.map(([key, value]) => {
                          const active = Math.abs(m.portion - value) < 0.01;
                          return (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                              key={key}
                              disabled={!canManageRoster}
                              onPress={() => setMemberPortion(m.id, value)}
                              className={`rounded-full px-2 py-0.5 ${
                                active ? "bg-primary-soft" : "bg-surface"
                              }`}
                              style={canManageRoster ? undefined : { opacity: 0.7 }}
                            >
                              <Text
                                className={`text-[11px] font-sans-medium ${
                                  active ? "text-primary-ink" : "text-muted-foreground"
                                }`}
                              >
                                {t(`appetite.${key}`)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      {canManageRoster && !isMe ? (
                        <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
                          {!m.uses_app ? (
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => markUsesApp.mutate(m.id)}
                            >
                              <Text className="text-[11px] font-sans-medium text-primary-ink underline">
                                {t("hogar.roster.usesAppNow")}
                              </Text>
                            </Pressable>
                          ) : null}
                          {m.user_id && !m.is_planner ? (
                            <Pressable
                              accessibilityRole="button"
                              onPress={() => makePlanner.mutate(m.id)}
                            >
                              <Text className="text-[11px] font-sans-medium text-muted-foreground underline">
                                {t("hogar.roster.makePlanner")}
                              </Text>
                            </Pressable>
                          ) : null}
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => dropMember.mutate(m.id)}
                          >
                            <Text className="text-[11px] font-sans-medium text-destructive underline">
                              {t("hogar.roster.remove")}
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                })}

                {tableKids.map(renderChildRow)}

                {babies.length ? (
                  <View className="mt-1 gap-2">
                    <Text className="text-[11px] font-sans-semibold uppercase tracking-wider text-muted-foreground">
                      {t("hogar.roster.babies")}
                    </Text>
                    {babies.map(renderChildRow)}
                    <ChildMealGapBanner
                      names={pendingKidMeals.map((c) => c.name)}
                      pending={fillKidsMut.isPending}
                      onUpdate={() => fillKidsMut.mutate()}
                    />
                  </View>
                ) : null}
              </View>

              {/* --- Añadir miembro: adulto o peque --- */}
              {canManageRoster ? (
                <View className="mt-3 gap-2 rounded-2xl bg-secondary/60 p-4">
                  <Text className="text-xs font-sans-semibold text-foreground">
                    {t("hogar.add.title")}
                  </Text>

                  <View className="flex-row gap-2">
                    {(
                      [
                        ["adult", "hogar.add.adult"],
                        ["child", "hogar.add.child"],
                      ] as const
                    ).map(([key, labelKey]) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected: addingType === key }}
                        key={key}
                        onPress={() => setAddingType(key)}
                        className={`flex-1 items-center rounded-xl py-2.5 ${
                          addingType === key ? "bg-primary-soft" : "bg-surface"
                        }`}
                      >
                        <Text
                          className={`text-xs font-sans-medium ${
                            addingType === key ? "text-primary-ink" : "text-muted-foreground"
                          }`}
                        >
                          {t(labelKey)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {addingType === "adult" ? (
                    <>
                      <TextInput
                        className={INPUT}
                        value={newAdult.name}
                        onChangeText={(v) => setNewAdult((p) => ({ ...p, name: v }))}
                        placeholder={t("hogar.add.name")}
                        accessibilityLabel={t("hogar.add.adultNameLabel")}
                        placeholderTextColor="#a69d8f"
                      />
                      <View className="flex-row gap-2">
                        {(
                          [
                            [true, "hogar.add.usesApp"],
                            [false, "hogar.add.noApp"],
                          ] as const
                        ).map(([value, labelKey]) => (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ selected: newAdult.usesApp === value }}
                            key={labelKey}
                            onPress={() => setNewAdult((p) => ({ ...p, usesApp: value }))}
                            className={`flex-1 items-center rounded-xl py-2 ${
                              newAdult.usesApp === value ? "bg-primary-soft" : "bg-surface"
                            }`}
                          >
                            <Text
                              className={`text-xs font-sans-medium ${
                                newAdult.usesApp === value
                                  ? "text-primary-ink"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {t(labelKey)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-[11px] text-muted-foreground">
                          {t("hogar.roster.portion")}
                        </Text>
                        {APPETITES.map(([key]) => (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityState={{ selected: newAdult.appetite === key }}
                            key={key}
                            onPress={() => setNewAdult((p) => ({ ...p, appetite: key }))}
                            className={`rounded-full px-2.5 py-1 ${
                              newAdult.appetite === key ? "bg-primary-soft" : "bg-surface"
                            }`}
                          >
                            <Text
                              className={`text-[11px] font-sans-medium ${
                                newAdult.appetite === key
                                  ? "text-primary-ink"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {t(`appetite.${key}`)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          addAdult.mutate(
                            {
                              name: newAdult.name,
                              usesApp: newAdult.usesApp,
                              portion: portionFor(newAdult.appetite),
                            },
                            {
                              onSuccess: () =>
                                setNewAdult({ name: "", usesApp: true, appetite: "normal" }),
                            },
                          )
                        }
                        disabled={addAdult.isPending || !newAdult.name.trim()}
                        className="flex-row items-center justify-center gap-2 rounded-full bg-secondary py-2.5 active:opacity-80"
                        style={
                          addAdult.isPending || !newAdult.name.trim() ? { opacity: 0.6 } : undefined
                        }
                      >
                        <UserPlus size={16} color="#3e3d39" />
                        <Text className="text-sm font-sans-medium text-foreground">
                          {t("hogar.add.addAdult")}
                        </Text>
                      </Pressable>
                      <Text className="text-[11px] text-muted-foreground">
                        {t("hogar.add.hint")}
                      </Text>
                    </>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setChildSheet({ open: true, child: null })}
                      className="flex-row items-center justify-center gap-2 rounded-full bg-secondary py-2.5 active:opacity-80"
                    >
                      <Baby size={16} color="#3e3d39" />
                      <Text className="text-sm font-sans-medium text-foreground">
                        {t("hogar.add.addChild")}
                      </Text>
                    </Pressable>
                  )}
                </View>
              ) : (
                // Explicar en vez de ocultar: antes este bloque simplemente
                // desaparecía para quien no era el creador, sin decir por qué.
                <View className="mt-3 rounded-2xl bg-secondary/60 px-4 py-3">
                  <Text className="text-[11.5px] leading-5 text-muted-foreground">
                    {t("hogar.roster.onlyManagers")}
                  </Text>
                </View>
              )}

              <View className="mt-4 flex-row items-start gap-2.5 rounded-2xl bg-muted px-3.5 py-3">
                <ShieldCheck size={14} color="#6b6256" style={{ marginTop: 1 }} />
                <Text className="flex-1 text-[11.5px] leading-5 text-muted-foreground">
                  {t("hogar.roster.profileNote")}
                </Text>
              </View>
            </View>

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
