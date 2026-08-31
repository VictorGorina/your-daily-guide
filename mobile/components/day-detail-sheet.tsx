import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";

import {
  MEAL_STATUS_LABEL,
  todayISO,
  updateLogByDate,
  type DailyLog,
  type MealStatus,
  type Profile,
} from "../lib/daily";
import { sumDoneMacros, ZERO_MACROS } from "../lib/macros";
import { isBeforeAppStart, mealsForDate, type MonthlyPlan } from "../lib/plan-shared";
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
export function DayDetailSheet({
  date,
  plan,
  log,
  profile,
  onClose,
}: {
  date: string | null;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!date} onOpenChange={(o) => !o && onClose()} title={date ? longDate(date) : ""}>
      {date ? <DayDetailBody date={date} plan={plan} log={log} profile={profile} /> : null}
    </Dialog>
  );
}

function DayDetailBody({
  date,
  plan,
  log,
  profile,
}: {
  date: string;
  plan: MonthlyPlan | null;
  log: DailyLog | undefined;
  profile: Profile | null;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<number | null>(null);

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
  const setStatus = (index: number, status: MealStatus) => {
    const next = habits.map((h, i) =>
      i === index ? { ...h, status, done: status === "plan" || status === "distinto" } : h,
    );
    correct.mutate({ habits: next });
    setEditing(null);
  };

  const plannedByLabel = new Map(mealsForDate(plan, date).map((m) => [m.moment, m.idea]));

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
                onPress={() => setEditing((prev) => (prev === i ? null : i))}
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
                        : changed
                          ? "text-primary"
                          : "text-foreground"
                    }`}
                  >
                    {planned || wasIdea}
                  </Text>
                ) : null}
                {wasIdea ? (
                  <Text className="mt-0.5 text-[11px] text-muted-foreground">
                    Plan sugerido: <Text className="line-through">{wasIdea}</Text>
                  </Text>
                ) : null}
              </Pressable>
              {editing === i ? (
                <View className="mt-1.5 flex-row flex-wrap gap-2 rounded-xl bg-secondary/40 p-2.5">
                  {(Object.keys(MEAL_STATUS_LABEL) as MealStatus[]).map((s) => {
                    const active = h.status === s;
                    return (
                      <Pressable
                        key={s}
                        onPress={() => setStatus(i, s)}
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
