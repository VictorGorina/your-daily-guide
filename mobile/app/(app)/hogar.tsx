import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Baby,
  ChevronDown,
  ChevronRight,
  ChefHat,
  Copy,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  UserPlus,
  Users,
} from "lucide-react-native";
import { useEffect, useState } from "react";
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

import { ChildSheet } from "../../components/child-sheet";
import { apiPost } from "../../lib/api";
import { fetchMonthlyPlan, monthISO, todayISO } from "../../lib/daily";
import {
  addAdultSlot,
  claimSlot,
  clearHouseholdGoal,
  createHousehold,
  fetchHousehold,
  leaveHousehold,
  openSlots,
  removeMember,
  renameHousehold,
  saveHouseholdGoal,
  saveHomeSchedule,
  saveSharedSlots,
  setPlanner,
  updateMember,
  type HouseholdChild,
  type HouseholdGoalType,
  type OpenSlot,
} from "../../lib/household";
import {
  DAY_LABEL,
  DAY_SHORT,
  EMPTY_SCHEDULE,
  MEAL_KEYS,
  MEAL_LABEL,
  deriveSharedSlots,
  describeSharedSlots,
  personColor,
  toggleDay,
  type Appetite,
  type HomeSchedule,
  type SharedSlots,
} from "../../lib/household-shared";
import { eur, shoppingTotal } from "../../lib/plan-shared";

const INPUT = "h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground";

/** Apetito → peso de ración para dimensionar la compra (adultos; los niños usan `childPortion`). */
const APPETITES: readonly [Appetite, string, number][] = [
  ["poco", "Poco", 0.8],
  ["normal", "Normal", 1],
  ["mucho", "Mucho", 1.2],
];
const portionFor = (a: Appetite) => APPETITES.find(([key]) => key === a)![2];

// La sincronización del plan compartido toca el plan del otro miembro con la
// clave de servicio, así que va por /api/v1/* como en la web (el resto del CRUD
// del hogar es directo a Supabase).
const syncSharedPlan = () =>
  apiPost<{ synced: number }>("household/sync", { month: monthISO(), today: todayISO() });

export default function Hogar() {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  const [name, setName] = useState("Mi casa");
  const [code, setCode] = useState("");
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  const [shared, setShared] = useState<SharedSlots | null>(null);
  const [addingType, setAddingType] = useState<"adult" | "child">("adult");
  const [schedDrafts, setSchedDrafts] = useState<Record<string, HomeSchedule>>({});
  const [schedExpanded, setSchedExpanded] = useState<Record<string, boolean>>({});
  const [newAdult, setNewAdult] = useState<{ name: string; usesApp: boolean; appetite: Appetite }>({
    name: "",
    usesApp: true,
    appetite: "normal",
  });
  const [goalType, setGoalType] = useState<HouseholdGoalType>("comportamiento");
  const [goalText, setGoalText] = useState("");
  const [goalBudget, setGoalBudget] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [childSheet, setChildSheet] = useState<{ open: boolean; child: HouseholdChild | null }>({
    open: false,
    child: null,
  });

  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const monthSpend = shoppingTotal(planQ.data?.shopping);

  useEffect(() => {
    if (state.data?.household) setShared(state.data.household.shared_slots);
    // Initialize per-member schedule drafts from server data.
    if (state.data?.members?.length || state.data?.children?.length) {
      const drafts: Record<string, HomeSchedule> = {};
      for (const m of state.data?.members ?? []) {
        drafts[m.id] = m.home_schedule ?? EMPTY_SCHEDULE;
      }
      for (const c of state.data?.children ?? []) {
        drafts[c.id] = c.home_schedule ?? EMPTY_SCHEDULE;
      }
      setSchedDrafts(drafts);
    }
  }, [state.data?.household, state.data?.members, state.data?.children]);

  useEffect(() => {
    const household = state.data?.household;
    if (!household) return;
    setGoalType(household.goal_type ?? "comportamiento");
    setGoalText(household.goal_text ?? "");
    setGoalBudget(household.goal_budget_eur != null ? String(household.goal_budget_eur) : "");
  }, [state.data?.household]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["household"] });

  const create = useMutation({
    mutationFn: () => createHousehold(name),
    onSuccess: () => {
      Alert.alert("Hogar creado");
      refresh();
    },
    onError: () => Alert.alert("No hemos podido crear el hogar"),
  });

  const lookup = useMutation({
    mutationFn: () => openSlots(code),
    onSuccess: (found) => setSlots(found),
    onError: () => Alert.alert("No hemos podido buscar tu familia"),
  });

  const claim = useMutation({
    mutationFn: (memberId: string) => claimSlot(code, memberId),
    onSuccess: () => {
      Alert.alert("¡Ya estás en la familia!");
      setCode("");
      setSlots(null);
      refresh();
    },
    onError: (e: Error) => Alert.alert(e.message),
  });

  const isCreator = state.data?.household?.created_by === state.data?.me?.user_id;
  const isPlanner = !!state.data?.me?.is_planner;
  const plannerName = state.data?.planner?.display_name ?? "quien lleva la cocina";

  const addAdult = useMutation({
    mutationFn: () => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      return addAdultSlot(householdId, {
        display_name: newAdult.name.trim(),
        uses_app: newAdult.usesApp,
        portion: portionFor(newAdult.appetite),
      });
    },
    onSuccess: () => {
      setNewAdult({ name: "", usesApp: true, appetite: "normal" });
      Alert.alert("Añadido a la mesa");
      refresh();
    },
    onError: () => Alert.alert("No hemos podido añadir a esa persona"),
  });

  const markUsesApp = useMutation({
    mutationFn: (id: string) => updateMember(id, { uses_app: true }),
    onSuccess: refresh,
  });

  const dropMember = useMutation({
    mutationFn: (id: string) => removeMember(id),
    onSuccess: refresh,
  });

  const makePlanner = useMutation({
    mutationFn: (id: string) => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      return setPlanner(householdId, id);
    },
    onSuccess: () => {
      Alert.alert("Cambiado quién planifica en casa");
      refresh();
    },
    onError: (e: Error) => Alert.alert(e.message),
  });

  const renameMember = (id: string, value: string) =>
    void updateMember(id, { display_name: value.trim() || "Miembro" }).then(refresh);
  const setMemberPortion = (id: string, portion: number) =>
    void updateMember(id, { portion }).then(refresh);

  const leave = useMutation({
    mutationFn: leaveHousehold,
    onSuccess: () => {
      Alert.alert("Has salido del hogar");
      refresh();
    },
  });

  const persistShared = useMutation({
    mutationFn: async (next: SharedSlots) => {
      await saveSharedSlots(next);
      await syncSharedPlan();
    },
    onSuccess: () => {
      Alert.alert("Comidas compartidas actualizadas");
      refresh();
      qc.invalidateQueries({ queryKey: ["plan", month] });
    },
    onError: (e: Error) => Alert.alert(e.message || "No hemos podido guardar"),
  });

  const persistSchedule = useMutation({
    mutationFn: async (opts: { memberId?: string; childId?: string; schedule: HomeSchedule }) => {
      await saveHomeSchedule(opts);
      await syncSharedPlan();
    },
    onSuccess: () => {
      Alert.alert("Horario guardado");
      refresh();
      qc.invalidateQueries({ queryKey: ["plan", month] });
    },
    onError: (e: Error) => Alert.alert(e.message || "No hemos podido guardar el horario"),
  });

  const syncNow = useMutation({
    mutationFn: syncSharedPlan,
    onSuccess: (r) =>
      Alert.alert(
        r.synced
          ? "Plan compartido con el resto del hogar"
          : "Nada que sincronizar todavía (aún no hay comidas compartidas o plan del otro miembro)",
      ),
    onError: () => Alert.alert("No hemos podido sincronizar el plan"),
  });

  const saveGoal = useMutation({
    mutationFn: async () => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      const budget = Number(goalBudget.replace(",", "."));
      await saveHouseholdGoal(householdId, {
        goal_type: goalType,
        goal_text: goalText,
        goal_budget_eur:
          Number.isFinite(budget) && budget > 0 ? Math.round(budget * 100) / 100 : null,
      });
    },
    onSuccess: () => {
      Alert.alert("Objetivo del hogar guardado");
      refresh();
    },
    onError: () => Alert.alert("No hemos podido guardar el objetivo"),
  });

  const dropGoal = useMutation({
    mutationFn: async () => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      await clearHouseholdGoal(householdId);
    },
    onSuccess: () => {
      setGoalText("");
      setGoalBudget("");
      refresh();
    },
  });

  const confirmLeave = () =>
    Alert.alert("¿Salir del hogar?", "Dejarás de compartir comidas y objetivo con el resto.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Salir", style: "destructive", onPress: () => leave.mutate() },
    ]);

  const shareCode = (inviteCode: string) =>
    void Share.share({
      message: `Únete a mi hogar en Peppers con el código ${inviteCode}`,
    }).catch(() => {
      /* el usuario canceló el diálogo */
    });

  const household = state.data?.household;
  const members = state.data?.members ?? [];
  const children = state.data?.children ?? [];
  const goalDisabled =
    saveGoal.isPending || (goalType === "comportamiento" ? !goalText.trim() : !goalBudget.trim());

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-28 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        {!household ? (
          <>
            <Text className="font-heading text-3xl text-foreground">Tu hogar</Text>
            <Text className="mt-2 text-sm text-muted-foreground">
              Si compartes mesa con alguien, vuestros menús y la compra se ajustan juntos. Sin
              perder tu propio plan.
            </Text>

            <View className="mt-6 gap-2 rounded-3xl bg-primary-soft p-5">
              <Text className="text-sm font-sans-semibold text-foreground">
                ¿Ya te han pasado un código?
              </Text>
              <Text className="text-xs leading-5 text-muted-foreground">
                Lo tiene arriba del todo quien ya esté dentro de la familia.
              </Text>
              {!slots ? (
                <>
                  <TextInput
                    className="mt-1 h-[60px] w-full rounded-2xl bg-surface px-4 text-center font-heading text-2xl uppercase tracking-widest text-foreground"
                    value={code}
                    onChangeText={(t) => setCode(t.toUpperCase())}
                    placeholder="ABC123"
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
                      {lookup.isPending ? "Buscando..." : "Unirme a la familia"}
                    </Text>
                  </Pressable>
                </>
              ) : slots.length ? (
                <View className="gap-2">
                  <Text className="text-xs text-muted-foreground">
                    ¿Quién eres? Toca tu nombre.
                  </Text>
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
                      Probar otro código
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View className="gap-2">
                  <Text className="text-xs text-muted-foreground">
                    No hay ningún sitio libre con ese código. Comprueba que está bien escrito o
                    pídele a quien creó la familia que te añada.
                  </Text>
                  <Pressable onPress={() => setSlots(null)} className="active:opacity-70">
                    <Text className="text-xs font-sans-medium text-muted-foreground underline">
                      Probar otro código
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>

            <View className="my-5 flex-row items-center gap-3">
              <View className="h-px flex-1 bg-border" />
              <Text className="text-[11px] font-sans-semibold uppercase tracking-widest text-muted-foreground">
                o empieza tú
              </Text>
              <View className="h-px flex-1 bg-border" />
            </View>

            <View className="gap-3 rounded-3xl bg-surface p-5">
              <View className="flex-row items-center gap-2">
                <Users size={16} color="#6dbe7b" />
                <Text className="text-sm font-sans-semibold text-foreground">Crear un hogar</Text>
              </View>
              <Text className="text-xs text-muted-foreground">
                Tendrás un código para invitar a quien vive contigo.
              </Text>
              <TextInput
                className={INPUT}
                value={name}
                onChangeText={setName}
                placeholder="Nombre del hogar"
                placeholderTextColor="#a69d8f"
              />
              <Pressable
                onPress={() => create.mutate()}
                disabled={create.isPending}
                className="items-center rounded-full bg-secondary py-3.5 active:opacity-80"
                style={create.isPending ? { opacity: 0.6 } : undefined}
              >
                <Text className="text-sm font-sans-semibold text-foreground">
                  {create.isPending ? "Creando..." : "Crear hogar"}
                </Text>
              </Pressable>
            </View>

            <View className="mt-4 flex-row items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3">
              <ShieldCheck size={16} color="#6dbe7b" style={{ marginTop: 1 }} />
              <Text className="flex-1 text-xs text-muted-foreground">
                Tu progreso personal (racha, comidas registradas, peso) nunca es visible para el
                resto del hogar.
              </Text>
            </View>
          </>
        ) : (
          <>
            <View className="mt-2 flex-row items-start gap-2.5">
              <View className="flex-1">
                <Text className="text-[11px] font-sans-semibold uppercase tracking-widest text-muted-foreground">
                  Tu familia
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
                  accessibilityLabel="Cambiar el nombre de la familia"
                  hitSlop={8}
                  className="mt-4 h-8 w-8 items-center justify-center rounded-full bg-secondary active:opacity-70"
                >
                  <Pencil size={15} color="#83796c" />
                </Pressable>
              ) : null}
            </View>

            <View className="mt-4 flex-row items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3">
              <ShieldCheck size={16} color="#6dbe7b" style={{ marginTop: 1 }} />
              <Text className="flex-1 text-xs text-muted-foreground">
                Tu progreso personal (racha, comidas registradas, peso) nunca es visible para el
                resto del hogar. Solo compartís las comidas comunes y el objetivo del hogar.
              </Text>
            </View>

            <View className="mt-4 gap-2.5 rounded-3xl bg-primary-soft p-5">
              <View className="flex-row items-baseline justify-between">
                <Text className="text-[11px] font-sans-semibold uppercase tracking-widest text-muted-foreground">
                  Código de la familia
                </Text>
                <Text className="text-[11px] text-muted-foreground">
                  {members.length} {members.length === 1 ? "miembro" : "miembros"}
                </Text>
              </View>
              <View className="flex-row items-center gap-3">
                <Text className="flex-1 font-heading text-3xl tracking-widest text-foreground">
                  {household.invite_code}
                </Text>
                <Pressable
                  onPress={() => shareCode(household.invite_code)}
                  className="flex-row items-center gap-2 rounded-full bg-surface px-4 py-3 active:opacity-80"
                >
                  <Copy size={16} color="#83796c" />
                  <Text className="text-sm font-sans-medium text-foreground">Compartir</Text>
                </Pressable>
              </View>
              <Text className="text-xs leading-5 text-muted-foreground">
                Quien lo tenga puede unirse a esta familia desde su app.
              </Text>
            </View>

            <View className="mt-4 rounded-3xl bg-surface p-5">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-sans-semibold text-foreground">Familia</Text>
                <Text className="text-[11px] text-muted-foreground">
                  {members.length + children.length}{" "}
                  {members.length + children.length === 1 ? "miembro" : "miembros"}
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
                        {isCreator && !isMe ? (
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
                              <Text className="text-[11px] font-sans-medium text-primary">
                                Planifica
                              </Text>
                            </View>
                          ) : null}
                          {isMe ? (
                            <Text className="rounded-full bg-surface px-2 py-1 text-[11px] font-sans-medium text-muted-foreground">
                              Tú
                            </Text>
                          ) : !m.uses_app ? (
                            <Text className="rounded-full bg-surface px-2 py-1 text-[11px] font-sans-medium text-muted-foreground">
                              Sin cuenta
                            </Text>
                          ) : !m.user_id ? (
                            <Text className="rounded-full bg-surface px-2 py-1 text-[11px] font-sans-medium text-muted-foreground">
                              Pendiente
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
                        <Text className="text-[11px] text-muted-foreground">Ración</Text>
                        {APPETITES.map(([key, label, value]) => {
                          const active = Math.abs(m.portion - value) < 0.01;
                          return (
                            <Pressable
                              key={key}
                              disabled={!isCreator}
                              onPress={() => setMemberPortion(m.id, value)}
                              className={`rounded-full px-2 py-0.5 ${
                                active ? "bg-primary-soft" : "bg-surface"
                              }`}
                              style={isCreator ? undefined : { opacity: 0.7 }}
                            >
                              <Text
                                className={`text-[11px] font-sans-medium ${
                                  active ? "text-primary" : "text-muted-foreground"
                                }`}
                              >
                                {label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>

                      {isCreator && !isMe ? (
                        <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
                          {!m.uses_app ? (
                            <Pressable onPress={() => markUsesApp.mutate(m.id)}>
                              <Text className="text-[11px] font-sans-medium text-primary underline">
                                Ya usa la app
                              </Text>
                            </Pressable>
                          ) : null}
                          {m.user_id && !m.is_planner ? (
                            <Pressable onPress={() => makePlanner.mutate(m.id)}>
                              <Text className="text-[11px] font-sans-medium text-muted-foreground underline">
                                Que planifique la casa
                              </Text>
                            </Pressable>
                          ) : null}
                          <Pressable onPress={() => dropMember.mutate(m.id)}>
                            <Text className="text-[11px] font-sans-medium text-destructive underline">
                              Quitar
                            </Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                })}

                {children.map((c) => {
                  const pal = personColor(c.id);
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
                          {c.age ? ` · ${c.age} años` : ""}
                        </Text>
                        <Text className="mt-0.5 text-xs text-muted-foreground">
                          {c.allergies ? `Alergias: ${c.allergies.toLowerCase()}` : "Sin alergias"}{" "}
                          · apetito {c.appetite ?? "normal"}
                        </Text>
                      </View>
                      <ChevronRight size={18} color="#83796c" />
                    </Pressable>
                  );
                })}
              </View>

              {/* --- Añadir miembro: adulto o peque --- */}
              {isCreator ? (
                <View className="mt-3 gap-2 rounded-2xl bg-secondary/60 p-4">
                  <Text className="text-xs font-sans-semibold text-foreground">
                    Añadir a alguien a la mesa
                  </Text>

                  <View className="flex-row gap-2">
                    {(
                      [
                        ["adult", "Adulto"],
                        ["child", "Peque"],
                      ] as const
                    ).map(([key, label]) => (
                      <Pressable
                        key={key}
                        onPress={() => setAddingType(key)}
                        className={`flex-1 items-center rounded-xl py-2.5 ${
                          addingType === key ? "bg-primary-soft" : "bg-surface"
                        }`}
                      >
                        <Text
                          className={`text-xs font-sans-medium ${
                            addingType === key ? "text-primary" : "text-muted-foreground"
                          }`}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  {addingType === "adult" ? (
                    <>
                      <TextInput
                        className={INPUT}
                        value={newAdult.name}
                        onChangeText={(t) => setNewAdult((p) => ({ ...p, name: t }))}
                        placeholder="Nombre"
                        placeholderTextColor="#a69d8f"
                      />
                      <View className="flex-row gap-2">
                        {(
                          [
                            [true, "Usa la app"],
                            [false, "No usa la app"],
                          ] as const
                        ).map(([value, label]) => (
                          <Pressable
                            key={label}
                            onPress={() => setNewAdult((p) => ({ ...p, usesApp: value }))}
                            className={`flex-1 items-center rounded-xl py-2 ${
                              newAdult.usesApp === value ? "bg-primary-soft" : "bg-surface"
                            }`}
                          >
                            <Text
                              className={`text-xs font-sans-medium ${
                                newAdult.usesApp === value
                                  ? "text-primary"
                                  : "text-muted-foreground"
                              }`}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <View className="flex-row items-center gap-1.5">
                        <Text className="text-[11px] text-muted-foreground">Ración</Text>
                        {APPETITES.map(([key, label]) => (
                          <Pressable
                            key={key}
                            onPress={() => setNewAdult((p) => ({ ...p, appetite: key }))}
                            className={`rounded-full px-2.5 py-1 ${
                              newAdult.appetite === key ? "bg-primary-soft" : "bg-surface"
                            }`}
                          >
                            <Text
                              className={`text-[11px] font-sans-medium ${
                                newAdult.appetite === key ? "text-primary" : "text-muted-foreground"
                              }`}
                            >
                              {label}
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
                          Añadir adulto
                        </Text>
                      </Pressable>
                      <Text className="text-[11px] text-muted-foreground">
                        Si usa la app, podrá unirse con el código y elegir su nombre de esta lista.
                      </Text>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => setChildSheet({ open: true, child: null })}
                      className="flex-row items-center justify-center gap-2 rounded-full bg-secondary py-2.5 active:opacity-80"
                    >
                      <Baby size={16} color="#3e3d39" />
                      <Text className="text-sm font-sans-medium text-foreground">Añadir peque</Text>
                    </Pressable>
                  )}
                </View>
              ) : null}

              <View className="mt-4 flex-row items-start gap-2.5 rounded-2xl bg-muted px-3.5 py-3">
                <ShieldCheck size={14} color="#83796c" style={{ marginTop: 1 }} />
                <Text className="flex-1 text-[11.5px] leading-5 text-muted-foreground">
                  Cada adulto edita su propio perfil desde Ajustes; aquí solo ves lo que comparte
                  con la casa. A los peques los editáis entre todos.
                </Text>
              </View>
            </View>

            <View className="mt-4 rounded-3xl bg-surface p-5">
              <Text className="text-sm font-sans-semibold text-foreground">
                ¿Cuándo come cada uno en casa?
              </Text>
              <Text className="mt-1 text-xs leading-5 text-muted-foreground">
                Cada persona marca los días que come en casa. Cuando coincidís, el plato es el mismo
                para todos.
              </Text>
              <Pressable
                onPress={() => setShowHelp((v) => !v)}
                className="mt-2 flex-row items-center gap-1.5 active:opacity-70"
              >
                <Text className="text-xs font-sans-medium text-primary">
                  {showHelp ? "Ocultar detalle" : "Cómo funciona exactamente"}
                </Text>
                <ChevronDown
                  size={14}
                  color="#ff8a3d"
                  style={{ transform: [{ rotate: showHelp ? "180deg" : "0deg" }] }}
                />
              </Pressable>
              {showHelp ? (
                <Text className="mt-2.5 rounded-2xl bg-muted px-3.5 py-3 text-xs leading-5 text-muted-foreground">
                  Cada persona indica qué días come en casa para cada comida. Si varios coincidís,{" "}
                  {plannerName} planifica el plato compartido. Si comes solo, tu plan va aparte. El
                  snack siempre es individual.
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
                  const draft = schedDrafts[person.key] ?? EMPTY_SCHEDULE;
                  const serverSched = person.isChild
                    ? children.find((ch) => ch.id === person.key)?.home_schedule
                    : members.find((mm) => mm.id === person.key)?.home_schedule;
                  const hasChanges =
                    JSON.stringify(draft) !== JSON.stringify(serverSched ?? EMPTY_SCHEDULE);

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
                          {MEAL_KEYS.reduce((sum, m) => sum + draft[m].length, 0)} comidas/sem
                        </Text>
                        <ChevronDown
                          size={16}
                          color="#83796c"
                          style={{
                            transform: [{ rotate: expanded ? "180deg" : "0deg" }],
                          }}
                        />
                      </Pressable>
                      {expanded ? (
                        <View className="mt-3 gap-3">
                          {MEAL_KEYS.map((meal) => {
                            const picked = draft[meal];
                            return (
                              <View key={meal}>
                                <View className="flex-row items-baseline justify-between">
                                  <Text className="text-xs font-sans-medium text-foreground">
                                    {MEAL_LABEL[meal]}
                                  </Text>
                                  <Text className="text-[11px] text-muted-foreground">
                                    {picked.length ? `${picked.length} de 7` : "—"}
                                  </Text>
                                </View>
                                <View className="mt-1.5 flex-row gap-1.5">
                                  {DAY_SHORT.map((label, day) => {
                                    const active = picked.includes(day);
                                    return (
                                      <Pressable
                                        key={day}
                                        disabled={!person.canEdit}
                                        accessibilityLabel={`${person.name} ${MEAL_LABEL[meal]} ${DAY_LABEL[day]}`}
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
                                            active ? "text-primary" : "text-muted-foreground"
                                          }`}
                                        >
                                          {label}
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
                                {persistSchedule.isPending ? "Guardando..." : "Guardar horario"}
                              </Text>
                            </Pressable>
                          ) : null}
                          {!person.canEdit ? (
                            <Text className="text-[11px] text-muted-foreground">
                              Solo {plannerName} puede cambiar este horario.
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
                const derivedSlots = deriveSharedSlots(
                  members.map((m) => ({
                    id: m.id,
                    isPlanner: m.is_planner,
                    homeSchedule: schedDrafts[m.id] ?? m.home_schedule ?? null,
                  })),
                  children.map((c) => ({
                    id: c.id,
                    homeSchedule: schedDrafts[c.id] ?? c.home_schedule ?? null,
                  })),
                );
                const anyShared = MEAL_KEYS.some((m) => derivedSlots[m].length);
                return anyShared ? (
                  <View className="mt-4 rounded-[14px] bg-muted px-3.5 py-3">
                    <Text className="text-[11px] font-sans-medium text-muted-foreground">
                      Comidas en común → {describeSharedSlots(derivedSlots)}
                    </Text>
                  </View>
                ) : null;
              })()}

              <Pressable
                onPress={() => syncNow.mutate()}
                disabled={syncNow.isPending}
                className="mt-3 flex-row items-center justify-center gap-2 rounded-full bg-secondary py-3 active:opacity-80"
                style={syncNow.isPending ? { opacity: 0.6 } : undefined}
              >
                {syncNow.isPending ? (
                  <ActivityIndicator size="small" color="#83796c" />
                ) : (
                  <RefreshCw size={16} color="#83796c" />
                )}
                <Text className="text-sm font-sans-medium text-foreground">
                  Sincronizar el plan del mes
                </Text>
              </Pressable>
            </View>

            <View className="mt-4 rounded-3xl bg-surface p-5">
              <View className="flex-row items-center gap-2">
                <Target size={16} color="#6dbe7b" />
                <Text className="text-sm font-sans-semibold text-foreground">
                  Objetivo del hogar
                </Text>
              </View>
              <Text className="mt-1 text-xs text-muted-foreground">
                Un objetivo compartido, visible para todos en casa. Vuestro progreso individual
                sigue siendo privado.
              </Text>

              <View className="mt-4 flex-row gap-2 rounded-full bg-secondary/80 p-1">
                {(
                  [
                    ["comportamiento", "Un hábito"],
                    ["presupuesto", "Un presupuesto"],
                  ] as const
                ).map(([key, label]) => {
                  const active = goalType === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setGoalType(key)}
                      className={`flex-1 items-center rounded-full py-2 active:opacity-80 ${active ? "bg-surface" : ""}`}
                    >
                      <Text
                        className={`text-xs font-sans-medium ${active ? "text-primary" : "text-muted-foreground"}`}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {goalType === "comportamiento" ? (
                <TextInput
                  className={`${INPUT} mt-3`}
                  value={goalText}
                  onChangeText={setGoalText}
                  placeholder="Ej. cenar juntos entre semana"
                  placeholderTextColor="#a69d8f"
                  maxLength={140}
                />
              ) : (
                <TextInput
                  className={`${INPUT} mt-3`}
                  value={goalBudget}
                  onChangeText={setGoalBudget}
                  placeholder="Presupuesto compartido del mes (€)"
                  placeholderTextColor="#a69d8f"
                  keyboardType="decimal-pad"
                />
              )}

              <Pressable
                onPress={() => saveGoal.mutate()}
                disabled={goalDisabled}
                className="mt-3 items-center rounded-full bg-primary py-3.5 active:opacity-90"
                style={goalDisabled ? { opacity: 0.6 } : undefined}
              >
                <Text className="text-sm font-sans-semibold text-primary-foreground">
                  {saveGoal.isPending ? "Guardando..." : "Guardar objetivo"}
                </Text>
              </Pressable>

              {household.goal_type === "comportamiento" && household.goal_text ? (
                <View className="mt-4 flex-row items-start gap-2 rounded-2xl bg-primary-soft px-4 py-3">
                  <Target size={16} color="#6dbe7b" style={{ marginTop: 1 }} />
                  <Text className="flex-1 text-sm text-primary">{household.goal_text}</Text>
                </View>
              ) : null}

              {household.goal_type === "presupuesto" && household.goal_budget_eur ? (
                <View className="mt-4">
                  <View className="flex-row items-baseline justify-between gap-3">
                    <Text className="flex-1 text-xs text-muted-foreground">
                      Compra de este mes vs. objetivo del hogar
                    </Text>
                    <Text
                      className={`text-lg font-sans-bold tabular-nums ${
                        monthSpend > household.goal_budget_eur ? "text-destructive" : "text-primary"
                      }`}
                    >
                      {eur(monthSpend)} / {eur(household.goal_budget_eur)}
                    </Text>
                  </View>
                  <View className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
                    <View
                      className={`h-full rounded-full ${
                        monthSpend > household.goal_budget_eur
                          ? "bg-danger"
                          : monthSpend / household.goal_budget_eur >= 0.85
                            ? "bg-warning"
                            : "bg-success"
                      }`}
                      style={{
                        width: `${Math.min(100, (monthSpend / household.goal_budget_eur) * 100)}%`,
                      }}
                    />
                  </View>
                  <Text className="mt-1.5 text-[11px] text-muted-foreground">
                    Es el total de tu propia lista de la compra, la que se comparte con el resto del
                    hogar cuando marcáis comidas comunes.
                  </Text>
                </View>
              ) : null}

              {household.goal_type ? (
                <Pressable
                  onPress={() => dropGoal.mutate()}
                  disabled={dropGoal.isPending}
                  className="mt-3 self-start active:opacity-70"
                >
                  <Text className="text-xs font-sans-medium text-muted-foreground underline">
                    Quitar objetivo
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <Pressable
              onPress={confirmLeave}
              className="mt-6 flex-row items-center justify-center gap-2 rounded-full bg-surface py-4 active:opacity-80"
            >
              <LogOut size={16} color="#83796c" />
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Salir del hogar
              </Text>
            </Pressable>

            <ChildSheet
              key={childSheet.child?.id ?? "new"}
              open={childSheet.open}
              child={childSheet.child}
              householdId={household.id}
              onClose={() => setChildSheet((s) => ({ ...s, open: false }))}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
