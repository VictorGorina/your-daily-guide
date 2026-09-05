import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";

import { apiPost } from "../lib/api";
import {
  MEAL_STATUS_LABEL,
  todayISO,
  updateLogByDate,
  type DailyLog,
  type MealStatus,
  type Profile,
} from "../lib/daily";
import { isSharedSlot, type SharedSlots } from "../lib/household-shared";
import { sumDoneMacros, ZERO_MACROS } from "../lib/macros";
import {
  childMealsForDate,
  isBeforeAppStart,
  mealsForDate,
  offListNote,
  type MonthlyPlan,
} from "../lib/plan-shared";
import { MacroBars } from "./macro-bars";
import { Dialog } from "./ui/dialog";

const longDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

/**
 * Detalle reducido de un día pasado: qué se comió, qué se falló y las macros del
 * día — como la pestaña Hoy pero en pequeño y sin el chat del coach ni la guía.
 * Reemplaza a la lista "Conversación por día" de la antigua subpestaña Historial.
 */
/** Contexto del hogar que necesita el toggle "toda la familia comió esto". */
export type DayDetailHousehold = {
  sharedSlots: SharedSlots;
  /** Todos los miembros con user_id (para saber si hay alguien más a quien propagar). */
  memberCount: number;
};

export function DayDetailSheet({
  date,
  plan,
  log,
  profile,
  householdChildren,
  household,
  onClose,
}: {
  date: string | null;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
  /** Niños de la casa, para el plato aparte de un niño ese día (issue 07). */
  householdChildren?: { id: string; name: string }[];
  /** Contexto del hogar para el toggle "toda la familia comió esto". */
  household?: DayDetailHousehold;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!date} onOpenChange={(o) => !o && onClose()} title={date ? longDate(date) : ""}>
      {date ? (
        <DayDetailBody
          date={date}
          plan={plan}
          log={log}
          profile={profile}
          householdChildren={householdChildren}
          household={household}
        />
      ) : null}
    </Dialog>
  );
}

export function DayDetailBody({
  date,
  plan,
  log,
  profile,
  householdChildren,
  household,
}: {
  date: string;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
  householdChildren?: { id: string; name: string }[];
  household?: DayDetailHousehold;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);
  // Texto libre de "qué comí realmente" por índice de habit, mientras se edita.
  const [actualDraft, setActualDraft] = useState<Record<number, string>>({});
  // Toggle "toda la familia comió esto" por índice de habit.
  const [familyToggle, setFamilyToggle] = useState<Record<number, boolean>>({});

  const habits = log?.habits ?? [];
  const editable = date < todayISO();
  const beforeStart = isBeforeAppStart(date, profile?.app_started_on);

  const correct = useMutation({
    mutationFn: (patch: Partial<DailyLog>) => updateLogByDate(date, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["logs"] });
      qc.invalidateQueries({ queryKey: ["logs", date.slice(0, 7)] });
    },
    onError: () => Alert.alert("No hemos podido guardar la corrección"),
  });

  /** ¿Este habit corresponde a una comida compartida ese día? */
  const isShared = (label: string): boolean => {
    if (!household || household.memberCount <= 1) return false;
    const labelToKey: Record<string, "desayuno" | "comida" | "cena"> = {
      desayuno: "desayuno",
      comida: "comida",
      cena: "cena",
    };
    const mealKey = labelToKey[label.toLowerCase()];
    if (!mealKey) return false;
    const weekday = (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
    return isSharedSlot(household.sharedSlots, mealKey, weekday);
  };

  const maybePropagateToFamily = (index: number, status: MealStatus, actual?: string) => {
    if (!familyToggle[index] || !habits[index]) return;
    apiPost<{ propagated: number }>("household/propagate-log", {
      date,
      habitLabel: habits[index].label,
      status,
      actual,
    }).then(
      (r) => {
        if (r.propagated > 0) Alert.alert(`Aplicado a ${r.propagated} familiar(es) más`);
      },
      () => {
        // Silencioso: el log propio ya se guardó, la propagación es best-effort.
      },
    );
  };

  const setStatus = (index: number, status: MealStatus) => {
    const actual = status === "distinto" ? actualDraft[index]?.trim() : undefined;
    const next = habits.map((h, i) =>
      i === index
        ? {
            ...h,
            status,
            done: status === "plan" || status === "distinto",
            ...(status === "distinto" ? { actual: actual || h.actual } : { actual: undefined }),
          }
        : h,
    );
    correct.mutate({ habits: next });
    maybePropagateToFamily(index, status, actual || habits[index]?.actual);
    setEditing(null);
    setActualDraft((d) => {
      const copy = { ...d };
      delete copy[index];
      return copy;
    });
    setFamilyToggle((t) => {
      const copy = { ...t };
      delete copy[index];
      return copy;
    });
  };

  /** Guardar solo el texto de "qué comí" sin cambiar el status. */
  const saveActual = (index: number) => {
    const text = actualDraft[index]?.trim();
    if (!text) return;
    const next = habits.map((h, i) => (i === index ? { ...h, actual: text } : h));
    correct.mutate({ habits: next });
    maybePropagateToFamily(index, "distinto", text);
    setEditing(null);
    setActualDraft((d) => {
      const copy = { ...d };
      delete copy[index];
      return copy;
    });
    setFamilyToggle((t) => {
      const copy = { ...t };
      delete copy[index];
      return copy;
    });
  };

  const dayMeals = mealsForDate(plan, date);
  const plannedByLabel = new Map(dayMeals.map((m) => [m.moment, m.idea]));
  // Platos aparte de un niño ese día (issue 07), por rótulo del momento.
  const kidMealsByLabel = new Map<string, { name: string; dish: string; off: string[] }[]>();
  for (const c of householdChildren ?? []) {
    for (const k of childMealsForDate(plan, date, c.id)) {
      const label = dayMeals.find((m) => m.slot === k.slot)?.moment;
      if (!label) continue;
      const list = kidMealsByLabel.get(label) ?? [];
      list.push({ name: c.name, dish: k.dish, off: k.off });
      kidMealsByLabel.set(label, list);
    }
  }

  if (!habits.length) {
    return (
      <Text className="text-sm text-muted-foreground">
        {beforeStart
          ? "Antes de empezar a usar Peppers. No hay nada registrado de este día."
          : "No registraste ninguna comida este día."}
      </Text>
    );
  }

  const doneCount = habits.filter((h) => h.done).length;
  const failedCount = habits.filter((h) => h.status === "salteo" || h.status == null).length;
  const consumed = sumDoneMacros(log?.guide?.mealMacros, habits) ?? ZERO_MACROS;
  const hasMacros = !!(log?.guide?.macroEstimate || log?.guide?.mealMacros?.length);

  return (
    <View className="gap-4">
      <View className="gap-1.5">
        <View className="flex-row items-baseline justify-between gap-2">
          <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
            Comidas
          </Text>
          <Text className="font-mono-medium text-[11px] text-muted-foreground">
            {doneCount} de {habits.length}
            {failedCount ? ` · ${failedCount} sin cumplir` : ""}
          </Text>
        </View>
        {habits.map((h, i) => {
          const planned = plannedByLabel.get(h.label) ?? "";
          const wasIdea = h.wasIdea && h.wasIdea !== planned ? h.wasIdea : null;
          const skipped = h.status === "salteo";
          const unlogged = h.status == null;
          const changed = h.status === "distinto";

          return (
            <View key={h.label}>
              <Pressable
                disabled={!editable}
                onPress={() => {
                  setEditing((prev) => (prev === i ? null : i));
                  // Pre-rellenar el draft con el valor existente si lo hay
                  if (h.actual && !(i in actualDraft)) {
                    setActualDraft((d) => ({ ...d, [i]: h.actual! }));
                  }
                }}
                className="rounded-xl bg-secondary/50 px-3 py-2.5 active:opacity-80"
                style={!editable ? { opacity: 0.7 } : undefined}
              >
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="text-[11px] font-sans-semibold text-foreground">{h.label}</Text>
                  <Text
                    className={`text-[11px] font-sans-medium ${
                      h.status === "plan"
                        ? "text-success"
                        : skipped || unlogged
                          ? "text-muted-foreground"
                          : "text-primary"
                    }`}
                  >
                    {unlogged ? "Sin registrar" : MEAL_STATUS_LABEL[h.status!]}
                  </Text>
                </View>
                {planned || wasIdea ? (
                  <Text
                    className={`mt-1 text-sm ${
                      skipped || unlogged
                        ? "text-muted-foreground line-through"
                        : changed && h.actual
                          ? "text-muted-foreground line-through"
                          : changed
                            ? "text-primary"
                            : "text-foreground"
                    }`}
                  >
                    {planned || wasIdea}
                  </Text>
                ) : null}
                {/* Mostrar qué comió realmente si ya lo indicó */}
                {changed && h.actual ? (
                  <Text className="mt-0.5 text-sm text-primary">Comí: {h.actual}</Text>
                ) : null}
                {wasIdea ? (
                  <Text className="mt-0.5 text-[11px] text-muted-foreground">
                    Plan sugerido: <Text className="line-through">{wasIdea}</Text>
                  </Text>
                ) : null}
                {(kidMealsByLabel.get(h.label) ?? []).map((k) => (
                  <Text
                    key={`${k.name}-${k.dish}`}
                    className="mt-0.5 text-[11px] text-muted-foreground"
                  >
                    Para {k.name}: <Text className="text-foreground">{k.dish}</Text>
                    {offListNote(k.off) ? ` · ${offListNote(k.off)}` : ""}
                  </Text>
                ))}
              </Pressable>
              {editing === i ? (
                <View className="mt-1.5 gap-2 rounded-xl bg-secondary/40 p-2.5">
                  <View className="flex-row flex-wrap gap-2">
                    {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((s) => {
                      const active = h.status === s;
                      return (
                        <Pressable
                          key={s}
                          onPress={() => {
                            if (s === "distinto") {
                              // Si no hay texto aún, no cerrar — esperar a que escriba
                              if (!actualDraft[i]?.trim() && !h.actual) return;
                            }
                            setStatus(i, s);
                          }}
                          className={`rounded-full px-3 py-1.5 active:opacity-80 ${
                            active ? "bg-foreground" : "bg-surface"
                          }`}
                        >
                          <Text
                            className={`text-xs font-sans-semibold ${
                              active ? "text-background" : "text-muted-foreground"
                            }`}
                          >
                            {MEAL_STATUS_LABEL[s]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {/* Toggle "toda la familia comió esto" para comidas compartidas */}
                  {isShared(h.label) ? (
                    <Pressable
                      onPress={() => setFamilyToggle((t) => ({ ...t, [i]: !t[i] }))}
                      className={`flex-row items-center gap-2 rounded-lg px-3 py-2 ${
                        familyToggle[i] ? "bg-primary-soft" : "bg-surface"
                      }`}
                    >
                      <Users size={16} color={familyToggle[i] ? "#ff8a3d" : "#83796c"} />
                      <Text
                        className={`text-xs font-sans-medium ${
                          familyToggle[i] ? "text-primary" : "text-muted-foreground"
                        }`}
                      >
                        Toda la familia comió esto
                      </Text>
                    </Pressable>
                  ) : null}
                  {/* Campo de texto para indicar qué comió realmente */}
                  <View className="gap-1.5">
                    <Text className="text-[11px] font-sans-medium text-muted-foreground">
                      ¿Qué comiste realmente?
                    </Text>
                    <TextInput
                      autoFocus={!h.actual}
                      value={actualDraft[i] ?? h.actual ?? ""}
                      onChangeText={(t) => setActualDraft((d) => ({ ...d, [i]: t }))}
                      onSubmitEditing={() => {
                        if (h.status === "distinto") saveActual(i);
                        else setStatus(i, "distinto");
                      }}
                      placeholder="Ej.: pizza, ensalada de pollo..."
                      placeholderTextColor="#a69d8f"
                      className="rounded-lg bg-surface px-3 py-2 text-sm text-foreground"
                    />
                    <Pressable
                      disabled={!actualDraft[i]?.trim() && !h.actual}
                      onPress={() => {
                        if (h.status === "distinto") saveActual(i);
                        else setStatus(i, "distinto");
                      }}
                      className="items-center rounded-full bg-primary py-2 active:opacity-90"
                      style={!actualDraft[i]?.trim() && !h.actual ? { opacity: 0.5 } : undefined}
                    >
                      <Text className="text-xs font-sans-semibold text-primary-foreground">
                        {h.status === "distinto" ? "Guardar" : "Comí esto"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
        {editable ? (
          <Text className="pt-0.5 text-[11px] text-muted-foreground">
            Corregir aquí es solo para tu historial: la compra ya hecha de ese mes no cambia.
          </Text>
        ) : null}
      </View>

      <View>
        <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
          Macros del día
        </Text>
        {hasMacros ? (
          <MacroBars
            estimate={consumed}
            target={log?.guide?.macroEstimate ?? null}
            weightKg={profile?.current_weight_kg ?? null}
            note={`~${consumed.kcal} kcal de lo que comiste ese día`}
          />
        ) : (
          <Text className="mt-2 text-sm text-muted-foreground">
            No hay estimación de macros para este día.
          </Text>
        )}
      </View>
    </View>
  );
}
