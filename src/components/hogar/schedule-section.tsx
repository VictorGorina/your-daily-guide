import { Baby, ChefHat, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { HouseholdChild, HouseholdMember } from "@/lib/household";
import {
  EMPTY_SCHEDULE,
  MEAL_KEYS,
  MEAL_LABEL,
  deriveSharedSlots,
  describeSharedSlots,
  personColor,
  toggleDay,
  type HomeSchedule,
} from "@/lib/household-shared";
import type { useHouseholdMutations } from "@/lib/use-household-mutations";

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
  // Per-member schedule drafts (keyed by member id or child id).
  const [schedDrafts, setSchedDrafts] = useState<Record<string, HomeSchedule>>({});
  // Which member/child schedule grids are expanded.
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
    <section className="surface-card mt-4 p-5">
      <h2 className="text-sm font-semibold">{t("hogar.schedule.title")}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {t("hogar.schedule.intro")}
      </p>
      <button
        onClick={() => setShowHelp((v) => !v)}
        className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary-ink"
      >
        {showHelp ? t("hogar.schedule.hideHelp") : t("hogar.schedule.showHelp")}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${showHelp ? "rotate-180" : ""}`}
        />
      </button>
      {showHelp ? (
        <p className="mt-2.5 rounded-[14px] bg-muted px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("hogar.schedule.help", { planner: plannerName })}
        </p>
      ) : null}

      {/* Per-member schedule grids */}
      <div className="mt-4 space-y-3">
        {[
          ...members.map((m) => ({
            key: m.id,
            name: m.display_name,
            isChild: false,
            canEdit: m.user_id === meUserId || isPlanner,
            colors: personColor(m.id),
            memberId: m.id,
            childId: undefined as string | undefined,
          })),
          ...kids.map((c) => ({
            key: c.id,
            name: c.name,
            isChild: true,
            canEdit: isPlanner,
            colors: personColor(c.id),
            memberId: undefined as string | undefined,
            childId: c.id,
          })),
        ].map((person) => {
          const expanded = schedExpanded[person.key] ?? false;
          const scheduleBaseline = sharedSlots ?? EMPTY_SCHEDULE;
          const draft = schedDrafts[person.key] ?? scheduleBaseline;
          const serverSched = person.isChild
            ? kids.find((c) => c.id === person.key)?.home_schedule
            : members.find((m) => m.id === person.key)?.home_schedule;
          // Sin horario propio, el punto de partida es el del hogar: así no
          // se marca "sin guardar" nada más abrir.
          const hasChanges =
            JSON.stringify(draft) !== JSON.stringify(serverSched ?? scheduleBaseline);

          return (
            <div key={person.key} className="rounded-[14px] bg-secondary/50 p-3">
              <button
                type="button"
                onClick={() => setSchedExpanded((p) => ({ ...p, [person.key]: !expanded }))}
                className="flex w-full items-center gap-2.5"
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold"
                  style={{
                    background: person.colors.soft,
                    color: person.colors.ink,
                  }}
                >
                  {person.isChild ? (
                    <Baby className="h-3.5 w-3.5" />
                  ) : (
                    person.name.charAt(0).toUpperCase()
                  )}
                </span>
                <span className="flex-1 text-left text-sm font-medium">
                  {person.name}
                  {person.memberId && members.find((m) => m.id === person.memberId)?.is_planner ? (
                    <ChefHat className="ml-1.5 inline h-3.5 w-3.5 text-primary-ink" />
                  ) : null}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {t("hogar.schedule.mealsPerWeek", {
                    n: MEAL_KEYS.reduce((sum, m) => sum + draft[m].length, 0),
                  })}
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    expanded ? "rotate-180" : ""
                  }`}
                />
              </button>
              {expanded ? (
                <div className="mt-3 space-y-3">
                  {MEAL_KEYS.map((meal) => {
                    const picked = draft[meal];
                    const mealLabel = t(`moments.${MEAL_LABEL[meal]}`);
                    return (
                      <div key={meal}>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-xs font-medium">{mealLabel}</p>
                          <span className="text-[11px] text-muted-foreground">
                            {picked.length
                              ? t("hogar.schedule.ofSeven", { n: picked.length })
                              : "—"}
                          </span>
                        </div>
                        <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                          {[0, 1, 2, 3, 4, 5, 6].map((day) => {
                            const active = picked.includes(day);
                            return (
                              <button
                                key={day}
                                disabled={!person.canEdit}
                                aria-label={t("hogar.schedule.dayLabel", {
                                  name: person.name,
                                  meal: mealLabel,
                                  day: t(`weekdaysLong.${day}`),
                                })}
                                onClick={() =>
                                  setSchedDrafts((prev) => ({
                                    ...prev,
                                    [person.key]: {
                                      ...draft,
                                      [meal]: toggleDay(draft[meal], day),
                                    },
                                  }))
                                }
                                className={`h-[38px] rounded-[12px] text-xs font-medium transition-colors ${
                                  active
                                    ? "bg-primary-soft text-primary-ink"
                                    : "bg-secondary text-muted-foreground"
                                } disabled:opacity-60`}
                              >
                                {t(`weekdaysInitial.${day}`)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {person.canEdit && hasChanges ? (
                    <button
                      onClick={() =>
                        persistSchedule.mutate({
                          memberId: person.isChild ? undefined : person.memberId,
                          childId: person.isChild ? person.childId : undefined,
                          schedule: draft,
                        })
                      }
                      disabled={persistSchedule.isPending}
                      className="w-full rounded-full bg-primary py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {persistSchedule.isPending
                        ? t("hogar.schedule.saving")
                        : t("hogar.schedule.save")}
                    </button>
                  ) : null}
                  {!person.canEdit ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("hogar.schedule.onlyPlanner", { planner: plannerName })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

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
          <div className="mt-4 rounded-[14px] bg-muted px-3.5 py-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t("hogar.schedule.shared", { slots: describeSharedSlots(derivedSlots, t) })}
            </p>
          </div>
        ) : null;
      })()}
    </section>
  );
}
