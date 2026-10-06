import { Baby, ChefHat, ChevronDown } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import type { HouseholdChild, HouseholdMember } from "../../lib/household";
import {
  EMPTY_SCHEDULE,
  MEAL_KEYS,
  MEAL_LABEL,
  deriveSharedSlots,
  describeSharedSlots,
  personColor,
  toggleDay,
  type HomeSchedule,
} from "../../lib/household-shared";
import type { useHouseholdMutations } from "../../lib/use-household-mutations";

type Mutations = ReturnType<typeof useHouseholdMutations>;

/**
 * «¿Cuándo come cada uno en casa?»: una rejilla de días por persona y, debajo,
 * las comidas que salen en común. Los borradores viven aquí hasta que se
 * guardan; `sharedSlots` (los días compartidos del hogar) es el punto de
 * partida de quien aún no tiene horario propio.
 */
export function HouseholdScheduleSection({
  members,
  kids,
  sharedSlots,
  meUserId,
  isPlanner,
  plannerName,
  persistSchedule,
}: {
  members: HouseholdMember[];
  kids: HouseholdChild[];
  sharedSlots: HomeSchedule | null | undefined;
  meUserId: string | null | undefined;
  isPlanner: boolean;
  plannerName: string;
  persistSchedule: Mutations["persistSchedule"];
}) {
  const { t } = useTranslation();
  const [schedDrafts, setSchedDrafts] = useState<Record<string, HomeSchedule>>({});
  const [schedExpanded, setSchedExpanded] = useState<Record<string, boolean>>({});
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    // Initialize per-member schedule drafts from server data.
    if (members.length || kids.length) {
      // Sin horario propio se parte de los días compartidos del hogar (no de
      // vacío): así "Guardar horario" no deja a nadie en "nunca en casa".
      const baseline = sharedSlots ?? EMPTY_SCHEDULE;
      const drafts: Record<string, HomeSchedule> = {};
      for (const m of members) {
        drafts[m.id] = m.home_schedule ?? baseline;
      }
      for (const c of kids) {
        drafts[c.id] = c.home_schedule ?? baseline;
      }
      setSchedDrafts(drafts);
    }
  }, [sharedSlots, members, kids]);

  return (
    <View className="mt-4 rounded-3xl bg-surface p-5">
      <Text className="text-sm font-sans-semibold text-foreground">
        {t("hogar.schedule.title")}
      </Text>
      <Text className="mt-1 text-xs leading-5 text-muted-foreground">
        {t("hogar.schedule.intro")}
      </Text>
      <Pressable
        accessibilityRole="button"
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
            canEdit: m.user_id === meUserId || isPlanner,
            colors: personColor(m.id),
            memberId: m.id,
            childId: undefined as string | undefined,
            isPlannerMember: m.is_planner,
          })),
          ...kids.map((c) => ({
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
          const scheduleBaseline = sharedSlots ?? EMPTY_SCHEDULE;
          const draft = schedDrafts[person.key] ?? scheduleBaseline;
          const serverSched = person.isChild
            ? kids.find((ch) => ch.id === person.key)?.home_schedule
            : members.find((mm) => mm.id === person.key)?.home_schedule;
          // Sin horario propio, el punto de partida es el del hogar: así
          // no se marca "sin guardar" nada más abrir.
          const hasChanges =
            JSON.stringify(draft) !== JSON.stringify(serverSched ?? scheduleBaseline);

          return (
            <View key={person.key} className="rounded-[14px] bg-secondary/50 p-3">
              <Pressable
                accessibilityRole="button"
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
                  <Text className="text-sm font-sans-medium text-foreground">{person.name}</Text>
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
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
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
                      accessibilityRole="button"
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
        const baseline = sharedSlots ?? EMPTY_SCHEDULE;
        const derivedSlots = deriveSharedSlots(
          members.map((m) => ({
            id: m.id,
            isPlanner: m.is_planner,
            homeSchedule: schedDrafts[m.id] ?? m.home_schedule ?? baseline,
          })),
          kids.map((c) => ({
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
  );
}
