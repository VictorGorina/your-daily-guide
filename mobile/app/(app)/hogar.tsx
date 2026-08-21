import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  Baby,
  ChevronLeft,
  Copy,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Target,
  Trash2,
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

import { apiPost } from "../../lib/api";
import { fetchMonthlyPlan, monthISO, todayISO } from "../../lib/daily";
import {
  addChild,
  clearHouseholdGoal,
  createHousehold,
  fetchHousehold,
  joinHousehold,
  leaveHousehold,
  removeChild,
  renameHousehold,
  saveHouseholdGoal,
  saveSharedMeals,
  type HouseholdGoalType,
} from "../../lib/household";
import {
  DAY_LABEL,
  DAY_SHORT,
  MEAL_KEYS,
  MEAL_LABEL,
  toggleDay,
  type SharedMeals,
} from "../../lib/household-shared";
import { eur, shoppingTotal } from "../../lib/plan-shared";

const INPUT = "h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground";

// La sincronización del plan compartido toca el plan del otro miembro con la
// clave de servicio, así que va por /api/v1/* como en la web (el resto del CRUD
// del hogar es directo a Supabase).
const syncSharedPlan = () =>
  apiPost<{ synced: number }>("household/sync", { month: monthISO(), today: todayISO() });

export default function Hogar() {
  const router = useRouter();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });

  const [name, setName] = useState("Mi casa");
  const [code, setCode] = useState("");
  const [shared, setShared] = useState<SharedMeals | null>(null);
  const [child, setChild] = useState({ name: "", age: "", allergies: "", appetite: "" });
  const [goalType, setGoalType] = useState<HouseholdGoalType>("comportamiento");
  const [goalText, setGoalText] = useState("");
  const [goalBudget, setGoalBudget] = useState("");

  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const monthSpend = shoppingTotal(planQ.data?.shopping);

  useEffect(() => {
    if (state.data?.me) setShared(state.data.me.shared_meals);
  }, [state.data?.me]);

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

  const join = useMutation({
    mutationFn: () => joinHousehold(code),
    onSuccess: () => {
      Alert.alert("Te has unido al hogar");
      setCode("");
      refresh();
    },
    onError: (e: Error) => Alert.alert(e.message),
  });

  const leave = useMutation({
    mutationFn: leaveHousehold,
    onSuccess: () => {
      Alert.alert("Has salido del hogar");
      refresh();
    },
  });

  const persistShared = useMutation({
    mutationFn: async (next: SharedMeals) => {
      await saveSharedMeals(next);
      await syncSharedPlan();
    },
    onSuccess: () => {
      Alert.alert("Comidas compartidas actualizadas");
      refresh();
      qc.invalidateQueries({ queryKey: ["plan", month] });
    },
    onError: () => Alert.alert("No hemos podido guardar"),
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

  const newChild = useMutation({
    mutationFn: async () => {
      const householdId = state.data?.household?.id;
      if (!householdId) throw new Error("Sin hogar");
      const age = Number(child.age.replace(",", "."));
      await addChild(householdId, {
        name: child.name.trim(),
        age: Number.isFinite(age) && age > 0 ? Math.round(age) : null,
        allergies: child.allergies.trim() || null,
        appetite: child.appetite.trim() || null,
        notes: null,
      });
    },
    onSuccess: () => {
      setChild({ name: "", age: "", allergies: "", appetite: "" });
      Alert.alert("Peque añadido");
      refresh();
    },
    onError: () => Alert.alert("Falta el nombre del peque"),
  });

  const dropChild = useMutation({
    mutationFn: (id: string) => removeChild(id),
    onSuccess: refresh,
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
  const others = members.filter((m) => m.user_id !== state.data?.me?.user_id);
  const goalDisabled =
    saveGoal.isPending || (goalType === "comportamiento" ? !goalText.trim() : !goalBudget.trim());

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-28 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.navigate("/ajustes"))}
          className="flex-row items-center gap-1 self-start active:opacity-70"
          hitSlop={8}
        >
          <ChevronLeft size={16} color="#83796c" />
          <Text className="text-xs font-sans-medium text-muted-foreground">Ajustes</Text>
        </Pressable>

        <Text className="mt-3 text-3xl font-display text-foreground">Tu hogar</Text>
        <Text className="mt-2 text-sm text-muted-foreground">
          Si compartes mesa con alguien, vuestros menús y la compra se ajustan juntos. Sin perder tu
          propio plan.
        </Text>

        <View className="mt-4 flex-row items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3">
          <ShieldCheck size={16} color="#6dbe7b" style={{ marginTop: 1 }} />
          <Text className="flex-1 text-xs text-muted-foreground">
            Tu progreso personal (racha, comidas registradas, peso) nunca es visible para el resto
            del hogar. Solo compartís lo que marquéis aquí como comidas comunes y el objetivo del
            hogar de abajo.
          </Text>
        </View>

        {!household ? (
          <>
            <View className="mt-6 gap-3 rounded-3xl border border-border bg-surface p-5">
              <View className="flex-row items-center gap-2">
                <Users size={16} color="#6dbe7b" />
                <Text className="text-sm font-sans-semibold text-foreground">Crear un hogar</Text>
              </View>
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
                className="items-center rounded-full bg-primary py-3.5 active:opacity-90"
                style={create.isPending ? { opacity: 0.6 } : undefined}
              >
                <Text className="text-sm font-sans-semibold text-primary-foreground">
                  {create.isPending ? "Creando..." : "Crear hogar"}
                </Text>
              </Pressable>
            </View>

            <View className="mt-4 gap-3 rounded-3xl border border-border bg-surface p-5">
              <Text className="text-sm font-sans-semibold text-foreground">
                Unirme con un código
              </Text>
              <TextInput
                className={`${INPUT} tracking-widest`}
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                placeholder="ABC123"
                placeholderTextColor="#a69d8f"
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Pressable
                onPress={() => join.mutate()}
                disabled={join.isPending || code.trim().length < 4}
                className="items-center rounded-full border border-input bg-surface py-3.5 active:opacity-80"
                style={join.isPending || code.trim().length < 4 ? { opacity: 0.6 } : undefined}
              >
                <Text className="text-sm font-sans-medium text-foreground">
                  {join.isPending ? "Uniéndome..." : "Unirme al hogar"}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View className="mt-6 gap-3 rounded-3xl border border-border bg-surface p-5">
              <Text className="text-sm font-sans-semibold text-foreground">{household.name}</Text>
              <TextInput
                key={`name-${household.id}`}
                className={INPUT}
                defaultValue={household.name}
                placeholderTextColor="#a69d8f"
                onEndEditing={(e) =>
                  void renameHousehold(household.id, e.nativeEvent.text).then(refresh)
                }
              />
              <Pressable
                onPress={() => shareCode(household.invite_code)}
                className="flex-row items-center justify-between rounded-2xl border border-dashed border-input bg-surface px-4 py-3 active:opacity-80"
              >
                <Text className="text-sm text-muted-foreground">Código de invitación</Text>
                <View className="flex-row items-center gap-2">
                  <Text className="font-mono text-base tracking-widest text-foreground">
                    {household.invite_code}
                  </Text>
                  <Copy size={16} color="#83796c" />
                </View>
              </Pressable>
              <Text className="text-xs text-muted-foreground">
                {members.length} adulto(s) en casa
                {others.length
                  ? `: ${others.map((m) => m.display_name ?? "otra persona").join(", ")} y tú`
                  : ". Comparte el código para que alguien se una."}
              </Text>
            </View>

            <View className="mt-4 rounded-3xl border border-border bg-surface p-5">
              <Text className="text-sm font-sans-semibold text-foreground">
                ¿Qué comidas compartís?
              </Text>
              <Text className="mt-1 text-xs text-muted-foreground">
                Marca los días que coméis lo mismo en casa. Solo se sincroniza cuando la otra
                persona también lo marca: los dos partís de un plato base común, salido de la misma
                compra. Si ese día quieres tu ración distinta (menos cantidad, sin un
                ingrediente...), dilo en "Comí distinto" desde Hoy — es tu ajuste personal, no
                cambia el plato del otro.
              </Text>
              <View className="mt-4 gap-4">
                {MEAL_KEYS.map((meal) => (
                  <View key={meal}>
                    <Text className="text-xs font-sans-medium text-foreground">
                      {MEAL_LABEL[meal]}
                    </Text>
                    <View className="mt-2 flex-row gap-1.5">
                      {DAY_SHORT.map((label, day) => {
                        const active = shared?.[meal].includes(day) ?? false;
                        return (
                          <Pressable
                            key={day}
                            accessibilityLabel={`${MEAL_LABEL[meal]} ${DAY_LABEL[day]}`}
                            onPress={() =>
                              setShared((prev) =>
                                prev ? { ...prev, [meal]: toggleDay(prev[meal], day) } : prev,
                              )
                            }
                            className={`h-10 flex-1 items-center justify-center rounded-xl border active:opacity-80 ${
                              active ? "border-primary bg-primary-soft" : "border-input bg-surface"
                            }`}
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
                  </View>
                ))}
              </View>
              <Pressable
                onPress={() => shared && persistShared.mutate(shared)}
                disabled={!shared || persistShared.isPending}
                className="mt-4 items-center rounded-full bg-primary py-3.5 active:opacity-90"
                style={!shared || persistShared.isPending ? { opacity: 0.6 } : undefined}
              >
                <Text className="text-sm font-sans-semibold text-primary-foreground">
                  {persistShared.isPending
                    ? "Guardando y ajustando..."
                    : "Guardar y ajustar planes"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => syncNow.mutate()}
                disabled={syncNow.isPending}
                className="mt-2 flex-row items-center justify-center gap-2 rounded-full border border-input bg-surface py-3 active:opacity-80"
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

            <View className="mt-4 rounded-3xl border border-border bg-surface p-5">
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

            <View className="mt-4 rounded-3xl border border-border bg-surface p-5">
              <View className="flex-row items-center gap-2">
                <Baby size={16} color="#6dbe7b" />
                <Text className="text-sm font-sans-semibold text-foreground">Peques en casa</Text>
              </View>
              <View className="mt-3 gap-2">
                {state.data?.children.map((c) => (
                  <View
                    key={c.id}
                    className="flex-row items-start gap-3 rounded-2xl border border-input bg-surface px-4 py-3"
                  >
                    <View className="flex-1">
                      <Text className="text-sm font-sans-medium text-foreground">
                        {c.name}
                        {c.age ? ` · ${c.age} años` : ""}
                      </Text>
                      <Text className="text-xs text-muted-foreground">
                        Alergias: {c.allergies ?? "ninguna"} · Apetito: {c.appetite ?? "normal"}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => dropChild.mutate(c.id)}
                      accessibilityLabel={`Quitar ${c.name}`}
                      hitSlop={8}
                      className="active:opacity-70"
                    >
                      <Trash2 size={16} color="#83796c" />
                    </Pressable>
                  </View>
                ))}
                {!state.data?.children.length ? (
                  <Text className="text-xs text-muted-foreground">
                    Añade a los niños para que los menús de casa les sirvan también.
                  </Text>
                ) : null}
              </View>

              <View className="mt-4 gap-2">
                <TextInput
                  className={INPUT}
                  value={child.name}
                  onChangeText={(t) => setChild({ ...child, name: t })}
                  placeholder="Nombre"
                  placeholderTextColor="#a69d8f"
                />
                <View className="flex-row gap-2">
                  <TextInput
                    className={`${INPUT} flex-1`}
                    value={child.age}
                    onChangeText={(t) => setChild({ ...child, age: t })}
                    placeholder="Edad"
                    placeholderTextColor="#a69d8f"
                    keyboardType="number-pad"
                  />
                  <TextInput
                    className={`${INPUT} flex-1`}
                    value={child.appetite}
                    onChangeText={(t) => setChild({ ...child, appetite: t })}
                    placeholder="Apetito (poco, normal...)"
                    placeholderTextColor="#a69d8f"
                  />
                </View>
                <TextInput
                  className={INPUT}
                  value={child.allergies}
                  onChangeText={(t) => setChild({ ...child, allergies: t })}
                  placeholder="Alergias o intolerancias"
                  placeholderTextColor="#a69d8f"
                />
                <Pressable
                  onPress={() => newChild.mutate()}
                  disabled={newChild.isPending || !child.name.trim()}
                  className="flex-row items-center justify-center gap-2 rounded-full border border-input bg-surface py-3 active:opacity-80"
                  style={newChild.isPending || !child.name.trim() ? { opacity: 0.6 } : undefined}
                >
                  <Plus size={16} color="#3e3d39" />
                  <Text className="text-sm font-sans-medium text-foreground">Añadir peque</Text>
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={confirmLeave}
              className="mt-6 flex-row items-center justify-center gap-2 rounded-full border border-input py-4 active:opacity-80"
            >
              <LogOut size={16} color="#83796c" />
              <Text className="text-sm font-sans-medium text-muted-foreground">
                Salir del hogar
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
