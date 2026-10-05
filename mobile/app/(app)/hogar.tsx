import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Baby,
  ChevronDown,
  ChevronRight,
  ChefHat,
  Copy,
  LogOut,
  Pencil,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { ChildMealGapBanner } from "../../components/child-meal-gap-banner";
import { ChildSheet } from "../../components/child-sheet";
import { apiPost } from "../../lib/api";
import { fetchMonthlyPlan, monthISO, todayISO } from "../../lib/daily";
import {
  addAdultSlot,
  claimSlot,
  createHousehold,
  fetchHousehold,
  leaveHousehold,
  openSlots,
  removeMember,
  renameHousehold,
  saveHomeSchedule,
  setPlanner,
  updateMember,
  type HouseholdChild,
  type OpenSlot,
} from "../../lib/household";
import {
  EMPTY_SCHEDULE,
  MEAL_KEYS,
  MEAL_LABEL,
  deriveSharedSlots,
  describeSharedSlots,
  eatsTableFood,
  personColor,
  toggleDay,
  type Appetite,
  type HomeSchedule,
} from "../../lib/household-shared";
import { childPureeGaps, type MonthlyPlan } from "../../lib/plan-shared";
import { rebuildPlanWithHousehold } from "../../lib/plan-recalc";

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

// La sincronización del plan compartido toca el plan del otro miembro con la
// clave de servicio, así que va por /api/v1/* como en la web (el resto del CRUD
// del hogar es directo a Supabase).
const syncSharedPlan = () =>
  apiPost<{ synced: number }>("household/sync", { month: monthISO(), today: todayISO() });

export default function Hogar() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  const [name, setName] = useState(() => t("hogar.create.defaultName"));
  const [code, setCode] = useState("");
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [addingType, setAddingType] = useState<"adult" | "child">("adult");
  const [schedDrafts, setSchedDrafts] = useState<Record<string, HomeSchedule>>({});
  const [schedExpanded, setSchedExpanded] = useState<Record<string, boolean>>({});
  const [newAdult, setNewAdult] = useState<{ name: string; usesApp: boolean; appetite: Appetite }>({
    name: "",
    usesApp: true,
    appetite: "normal",
  });
  // La mesa o los horarios cambiaron en esta visita: el plan del mes aún no
  // cuenta con ello hasta que quien planifica lo rehaga.
  const [tableChanged, setTableChanged] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [childSheet, setChildSheet] = useState<{ open: boolean; child: HouseholdChild | null }>({
    open: false,
    child: null,
  });

  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });

  useEffect(() => {
    // Initialize per-member schedule drafts from server data.
    if (state.data?.members?.length || state.data?.children?.length) {
      // Sin horario propio se parte de los días compartidos del hogar (no de
      // vacío): así "Guardar horario" no deja a nadie en "nunca en casa".
      const baseline = state.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
      const drafts: Record<string, HomeSchedule> = {};
      for (const m of state.data?.members ?? []) {
        drafts[m.id] = m.home_schedule ?? baseline;
      }
      for (const c of state.data?.children ?? []) {
        drafts[c.id] = c.home_schedule ?? baseline;
      }
      setSchedDrafts(drafts);
    }
  }, [state.data?.household, state.data?.members, state.data?.children]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["household"] });

  const create = useMutation({
    mutationFn: () => createHousehold(name),
    onSuccess: () => {
      Alert.alert(t("hogar.create.done"));
      refresh();
    },
    onError: () => Alert.alert(t("hogar.create.failed")),
  });

  const lookup = useMutation({
    mutationFn: () => openSlots(code),
    onSuccess: (found) => setSlots(found),
    // La búsqueda cuenta los códigos malos: al llegar al límite, que lo diga.
    onError: (e: Error) =>
      Alert.alert(e.message.includes("Demasiados") ? e.message : t("hogar.join.lookupFailed")),
  });

  const claim = useMutation({
    mutationFn: (memberId: string) => claimSlot(code, memberId),
    onSuccess: () => {
      Alert.alert(t("hogar.join.joined"));
      setCode("");
      setSlots(null);
      refresh();
    },
    onError: (e: Error) => Alert.alert(e.message),
  });

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

  const addAdult = useMutation({
    mutationFn: () => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error(t("hogar.roster.noHousehold"));
      return addAdultSlot(householdId, {
        display_name: newAdult.name.trim(),
        uses_app: newAdult.usesApp,
        portion: portionFor(newAdult.appetite),
      });
    },
    onSuccess: () => {
      setNewAdult({ name: "", usesApp: true, appetite: "normal" });
      Alert.alert(t("hogar.add.added"));
      refresh();
      recalcRoster();
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
      recalcRoster();
    },
  });

  const makePlanner = useMutation({
    mutationFn: (id: string) => {
      const householdId = state.data?.household?.id;
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
      recalcRoster();
    });

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
      setTableChanged(true);
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
      setTableChanged(false);
      Alert.alert(t(r?.synced ? "hogar.rebuild.doneSynced" : "hogar.rebuild.done"));
    },
    onError: (e: Error) => {
      console.warn("hogar: rehaciendo el plan con la familia", e);
      Alert.alert(t("hogar.rebuild.failed"));
    },
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
  const fillKidsMut = useMutation({
    mutationFn: () =>
      apiPost<{ plan: MonthlyPlan; filled: number; children: string[] }>("plan/child-meal-fill", {
        today,
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
  const renderChildRow = (c: HouseholdChild) => {
    const pal = personColor(c.id);
    // Quien aún no come de la mesa enseña su etapa en vez de alergias y apetito.
    const note = eatsTableFood(c.feeding_stage)
      ? ""
      : t(`hogar.child.stageNote.${c.feeding_stage}`);
    return (
      <Pressable
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
            <Text className="font-heading text-3xl text-foreground">{t("hogar.title")}</Text>
            <Text className="mt-2 text-sm text-muted-foreground">{t("hogar.intro")}</Text>

            <View className="mt-6 gap-2 rounded-3xl bg-primary-soft p-5">
              <Text className="text-sm font-sans-semibold text-foreground">
                {t("hogar.join.title")}
              </Text>
              <Text className="text-xs leading-5 text-muted-foreground">
                {t("hogar.join.hint")}
              </Text>
              {!slots ? (
                <>
                  <TextInput
                    className="mt-1 h-[60px] w-full rounded-2xl bg-surface px-4 text-center font-heading text-2xl uppercase tracking-widest text-foreground"
                    value={code}
                    onChangeText={(v) => setCode(v.toUpperCase())}
                    placeholder="ABC123"
                    accessibilityLabel={t("hogar.join.codeLabel")}
                    placeholderTextColor="#a69d8f"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                  <Pressable
                    onPress={() => lookup.mutate()}
                    disabled={lookup.isPending || code.trim().length < 4}
                    className="mt-1 items-center rounded-full bg-primary py-3.5 active:opacity-90"
                    style={
                      lookup.isPending || code.trim().length < 4 ? { opacity: 0.6 } : undefined
                    }
                  >
                    <Text className="text-sm font-sans-semibold text-primary-foreground">
                      {lookup.isPending ? t("hogar.join.searching") : t("hogar.join.submit")}
                    </Text>
                  </Pressable>
                </>
              ) : slots.length ? (
                <View className="gap-2">
                  <Text className="text-xs text-muted-foreground">{t("hogar.join.pickWho")}</Text>
                  {slots.map((s) => {
                    const pal = personColor(s.id);
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => claim.mutate(s.id)}
                        disabled={claim.isPending}
                        className="flex-row items-center gap-3 rounded-2xl bg-surface px-4 py-3 active:opacity-80"
                        style={claim.isPending ? { opacity: 0.6 } : undefined}
                      >
                        <View
                          className="h-9 w-9 items-center justify-center rounded-full"
                          style={{ backgroundColor: pal.soft }}
                        >
                          <Text className="font-heading text-sm" style={{ color: pal.ink }}>
                            {(s.display_name.trim()[0] ?? "?").toUpperCase()}
                          </Text>
                        </View>
                        <Text className="text-sm font-sans-medium text-foreground">
                          {s.display_name}
                        </Text>
                      </Pressable>
                    );
                  })}
                  <Pressable onPress={() => setSlots(null)} className="active:opacity-70">
                    <Text className="text-xs font-sans-medium text-muted-foreground underline">
                      {t("hogar.join.otherCode")}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View className="gap-2">
                  <Text className="text-xs text-muted-foreground">{t("hogar.join.noSlots")}</Text>
                  <Pressable onPress={() => setSlots(null)} className="active:opacity-70">
                    <Text className="text-xs font-sans-medium text-muted-foreground underline">
                      {t("hogar.join.otherCode")}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>

            <View className="my-5 flex-row items-center gap-3">
              <View className="h-px flex-1 bg-border" />
              <Text className="text-[11px] font-sans-semibold uppercase tracking-widest text-muted-foreground">
                {t("hogar.orStart")}
              </Text>
              <View className="h-px flex-1 bg-border" />
            </View>

            <View className="gap-3 rounded-3xl bg-surface p-5">
              <View className="flex-row items-center gap-2">
                <Users size={16} color="#6dbe7b" />
                <Text className="text-sm font-sans-semibold text-foreground">
                  {t("hogar.create.title")}
                </Text>
              </View>
              <Text className="text-xs text-muted-foreground">{t("hogar.create.hint")}</Text>
              <TextInput
                className={INPUT}
                value={name}
                onChangeText={setName}
                placeholder={t("hogar.create.nameLabel")}
                placeholderTextColor="#a69d8f"
              />
              <Pressable
                onPress={() => create.mutate()}
                disabled={create.isPending}
                className="items-center rounded-full bg-secondary py-3.5 active:opacity-80"
                style={create.isPending ? { opacity: 0.6 } : undefined}
              >
                <Text className="text-sm font-sans-semibold text-foreground">
                  {create.isPending ? t("hogar.create.creating") : t("hogar.create.submit")}
                </Text>
              </Pressable>
            </View>

            <View className="mt-4 flex-row items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3">
              <ShieldCheck size={16} color="#6dbe7b" style={{ marginTop: 1 }} />
              <Text className="flex-1 text-xs text-muted-foreground">{t("hogar.privacy")}</Text>
            </View>
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
                      void renameHousehold(household.id, e.nativeEvent.text).then(refresh);
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
                            <Pressable onPress={() => markUsesApp.mutate(m.id)}>
                              <Text className="text-[11px] font-sans-medium text-primary-ink underline">
                                {t("hogar.roster.usesAppNow")}
                              </Text>
                            </Pressable>
                          ) : null}
                          {m.user_id && !m.is_planner ? (
                            <Pressable onPress={() => makePlanner.mutate(m.id)}>
                              <Text className="text-[11px] font-sans-medium text-muted-foreground underline">
                                {t("hogar.roster.makePlanner")}
                              </Text>
                            </Pressable>
                          ) : null}
                          <Pressable onPress={() => dropMember.mutate(m.id)}>
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
                        onPress={() => addAdult.mutate()}
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

            <View className="mt-4 rounded-3xl bg-surface p-5">
              <Text className="text-sm font-sans-semibold text-foreground">
                {t("hogar.schedule.title")}
              </Text>
              <Text className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("hogar.schedule.intro")}
              </Text>
              <Pressable
                onPress={() => setShowHelp((v) => !v)}
                className="mt-2 flex-row items-center gap-1.5 active:opacity-70"
              >
                <Text className="text-xs font-sans-medium text-primary-ink">
                  {showHelp ? t("hogar.schedule.hideHelp") : t("hogar.schedule.showHelp")}
                </Text>
                <ChevronDown
                  size={14}
                  color="#a84a17"
                  style={{ transform: [{ rotate: showHelp ? "180deg" : "0deg" }] }}
                />
              </Pressable>
              {showHelp ? (
                <Text className="mt-2.5 rounded-2xl bg-muted px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                  {t("hogar.schedule.help", { planner: plannerName })}
                </Text>
              ) : null}

              {/* Per-member schedule grids */}
              <View className="mt-4 gap-3">
                {[
                  ...members.map((m) => ({
                    key: m.id,
                    name: m.display_name,
                    isChild: false,
                    canEdit: m.user_id === state.data?.me?.user_id || isPlanner,
                    colors: personColor(m.id),
                    memberId: m.id,
                    childId: undefined as string | undefined,
                    isPlannerMember: m.is_planner,
                  })),
                  ...children.map((c) => ({
                    key: c.id,
                    name: c.name,
                    isChild: true,
                    canEdit: isPlanner,
                    colors: personColor(c.id),
                    memberId: undefined as string | undefined,
                    childId: c.id,
                    isPlannerMember: false,
                  })),
                ].map((person) => {
                  const expanded = schedExpanded[person.key] ?? false;
                  const scheduleBaseline = state.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
                  const draft = schedDrafts[person.key] ?? scheduleBaseline;
                  const serverSched = person.isChild
                    ? children.find((ch) => ch.id === person.key)?.home_schedule
                    : members.find((mm) => mm.id === person.key)?.home_schedule;
                  // Sin horario propio, el punto de partida es el del hogar: así
                  // no se marca "sin guardar" nada más abrir.
                  const hasChanges =
                    JSON.stringify(draft) !== JSON.stringify(serverSched ?? scheduleBaseline);

                  return (
                    <View key={person.key} className="rounded-[14px] bg-secondary/50 p-3">
                      <Pressable
                        onPress={() => setSchedExpanded((p) => ({ ...p, [person.key]: !expanded }))}
                        className="flex-row items-center gap-2.5"
                      >
                        <View
                          className="h-7 w-7 items-center justify-center rounded-full"
                          style={{
                            backgroundColor: person.colors.soft,
                          }}
                        >
                          {person.isChild ? (
                            <Baby size={14} color={person.colors.ink} />
                          ) : (
                            <Text
                              className="text-xs font-sans-semibold"
                              style={{ color: person.colors.ink }}
                            >
                              {person.name.charAt(0).toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <View className="flex-1 flex-row items-center">
                          <Text className="text-sm font-sans-medium text-foreground">
                            {person.name}
                          </Text>
                          {person.isPlannerMember ? (
                            <ChefHat size={14} color="#6dbe7b" style={{ marginLeft: 6 }} />
                          ) : null}
                        </View>
                        <Text className="text-[11px] text-muted-foreground">
                          {t("hogar.schedule.mealsPerWeek", {
                            n: MEAL_KEYS.reduce((sum, m) => sum + draft[m].length, 0),
                          })}
                        </Text>
                        <ChevronDown
                          size={16}
                          color="#6b6256"
                          style={{
                            transform: [{ rotate: expanded ? "180deg" : "0deg" }],
                          }}
                        />
                      </Pressable>
                      {expanded ? (
                        <View className="mt-3 gap-3">
                          {MEAL_KEYS.map((meal) => {
                            const picked = draft[meal];
                            const mealLabel = t(`moments.${MEAL_LABEL[meal]}`);
                            return (
                              <View key={meal}>
                                <View className="flex-row items-baseline justify-between">
                                  <Text className="text-xs font-sans-medium text-foreground">
                                    {mealLabel}
                                  </Text>
                                  <Text className="text-[11px] text-muted-foreground">
                                    {picked.length
                                      ? t("hogar.schedule.ofSeven", { n: picked.length })
                                      : "—"}
                                  </Text>
                                </View>
                                <View className="mt-1.5 flex-row gap-1.5">
                                  {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                                    const active = picked.includes(day);
                                    return (
                                      <Pressable
                                        key={day}
                                        disabled={!person.canEdit}
                                        accessibilityLabel={t("hogar.schedule.dayLabel", {
                                          name: person.name,
                                          meal: mealLabel,
                                          day: t(`weekdaysLong.${day}`),
                                        })}
                                        onPress={() =>
                                          setSchedDrafts((prev) => ({
                                            ...prev,
                                            [person.key]: {
                                              ...draft,
                                              [meal]: toggleDay(draft[meal], day),
                                            },
                                          }))
                                        }
                                        className={`h-[38px] flex-1 items-center justify-center rounded-[12px] active:opacity-80 ${
                                          active ? "bg-primary-soft" : "bg-secondary"
                                        }`}
                                        style={person.canEdit ? undefined : { opacity: 0.6 }}
                                      >
                                        <Text
                                          className={`text-xs font-sans-medium ${
                                            active ? "text-primary-ink" : "text-muted-foreground"
                                          }`}
                                        >
                                          {t(`weekdaysInitial.${day}`)}
                                        </Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              </View>
                            );
                          })}
                          {person.canEdit && hasChanges ? (
                            <Pressable
                              onPress={() =>
                                persistSchedule.mutate({
                                  memberId: person.isChild ? undefined : person.memberId,
                                  childId: person.isChild ? person.childId : undefined,
                                  schedule: draft,
                                })
                              }
                              disabled={persistSchedule.isPending}
                              className="items-center rounded-full bg-primary py-2.5 active:opacity-90"
                              style={persistSchedule.isPending ? { opacity: 0.6 } : undefined}
                            >
                              <Text className="text-xs font-sans-semibold text-primary-foreground">
                                {persistSchedule.isPending
                                  ? t("hogar.schedule.saving")
                                  : t("hogar.schedule.save")}
                              </Text>
                            </Pressable>
                          ) : null}
                          {!person.canEdit ? (
                            <Text className="text-[11px] text-muted-foreground">
                              {t("hogar.schedule.onlyPlanner", { planner: plannerName })}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {/* Derived shared-slots summary */}
              {(() => {
                const baseline = state.data?.household?.shared_slots ?? EMPTY_SCHEDULE;
                const derivedSlots = deriveSharedSlots(
                  members.map((m) => ({
                    id: m.id,
                    isPlanner: m.is_planner,
                    homeSchedule: schedDrafts[m.id] ?? m.home_schedule ?? baseline,
                  })),
                  children.map((c) => ({
                    id: c.id,
                    homeSchedule: schedDrafts[c.id] ?? c.home_schedule ?? baseline,
                    stage: c.feeding_stage,
                  })),
                );
                const anyShared = MEAL_KEYS.some((m) => derivedSlots[m].length);
                return anyShared ? (
                  <View className="mt-4 rounded-[14px] bg-muted px-3.5 py-3">
                    <Text className="text-[11px] font-sans-medium text-muted-foreground">
                      {t("hogar.schedule.shared", {
                        slots: describeSharedSlots(derivedSlots, t),
                      })}
                    </Text>
                  </View>
                ) : null;
              })()}
            </View>

            {isPlanner && (members.length > 1 || children.length > 0) ? (
              <View className="mt-4 rounded-3xl bg-surface p-5">
                <View className="flex-row items-center gap-2">
                  <RefreshCw size={16} color="#6dbe7b" />
                  <Text className="text-sm font-sans-semibold text-foreground">
                    {t("hogar.rebuild.title")}
                  </Text>
                </View>
                <Text className="mt-1 text-xs text-muted-foreground">
                  {t("hogar.rebuild.intro")}
                </Text>
                {tableChanged ? (
                  <View className="mt-3 rounded-2xl bg-primary-soft px-4 py-3">
                    <Text className="text-xs text-primary-ink">{t("hogar.rebuild.changed")}</Text>
                  </View>
                ) : null}
                <Pressable
                  onPress={() => rebuild.mutate()}
                  disabled={rebuild.isPending || !planQ.data?.plan}
                  className="mt-3 flex-row items-center justify-center gap-2 rounded-full bg-primary py-3.5 active:opacity-90"
                  style={rebuild.isPending || !planQ.data?.plan ? { opacity: 0.6 } : undefined}
                >
                  {rebuild.isPending ? (
                    <ActivityIndicator size="small" color="#3e3d39" />
                  ) : (
                    <RefreshCw size={16} color="#3e3d39" />
                  )}
                  <Text className="text-sm font-sans-semibold text-primary-foreground">
                    {rebuild.isPending ? t("hogar.rebuild.running") : t("hogar.rebuild.submit")}
                  </Text>
                </Pressable>
                {rebuild.isPending ? (
                  <Text className="mt-2 text-center text-[11px] text-muted-foreground">
                    {t("hogar.rebuild.wait")}
                  </Text>
                ) : !planQ.data?.plan ? (
                  <Text className="mt-2 text-center text-[11px] text-muted-foreground">
                    {t("hogar.rebuild.noPlan")}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Pressable
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
