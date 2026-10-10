import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  Briefcase,
  CalendarRange,
  Check,
  ChevronRight,
  Home,
  PencilLine,
  Undo2,
  X,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { apiPost } from "../../lib/api";
import type { DailyGuide, DailyLog } from "../../lib/daily";
import { classifyDish, FOOD_CATEGORIES } from "../../lib/food-categories";
import type { HouseholdState } from "../../lib/household";
import { EMPTY_SCHEDULE, personColor, type SharedSlots } from "../../lib/household-shared";
import {
  childPureeGaps,
  dishChangeIsMine,
  offListNote,
  suggestedDish,
  type mealsForDate,
  type MonthlyPlan,
} from "../../lib/plan-shared";
import {
  childMealsFor,
  mealCompanions,
  MOMENT_RANK,
  MOMENT_TO_MEAL_KEY,
  rankOf,
} from "../../lib/today-meals";
import { ChildMealGapBanner } from "../child-meal-gap-banner";
import { DishRecipe } from "../dish-recipe";
import { DishCategoryIcon } from "../food-category-bg";

// Mezcla un color accent con el fondo a un porcentaje
function tintBg(accent: string, pct: number): string {
  // Aproximación: convertir hex a rgba con opacidad
  const r = parseInt(accent.slice(1, 3), 16);
  const g = parseInt(accent.slice(3, 5), 16);
  const b = parseInt(accent.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${pct / 100})`;
}

/**
 * "Comidas de hoy": una fila por comida del registro, con su plato, quién se
 * sienta a la mesa, los platos aparte de los peques y la receta. Las acciones
 * (comí esto, comí otra cosa, deshacer) las resuelve la pantalla.
 */
export function MealStrip({
  habits,
  todayMeals,
  mealMacros,
  showNumbers,
  date,
  month,
  plan,
  household,
  sharedSlots,
  homePlanner,
  noPlanYet,
  loadFailed,
  onRetry,
  isAdjusting,
  onEdit,
  onAte,
  onClear,
}: {
  habits: DailyLog["habits"];
  todayMeals: ReturnType<typeof mealsForDate>;
  mealMacros: DailyGuide["mealMacros"];
  showNumbers: boolean;
  /** Hoy, `YYYY-MM-DD`. */
  date: string;
  month: string;
  plan: MonthlyPlan | null;
  household: HouseholdState | null | undefined;
  sharedSlots: SharedSlots | null;
  /** Base de `dishChangeIsMine` (ver la pantalla). */
  homePlanner: { isPlanner: boolean; sharedSlots: SharedSlots } | null;
  noPlanYet: boolean;
  loadFailed: boolean;
  onRetry: () => void;
  /** Esta comida espera al lote del día. */
  isAdjusting: (label: string) => boolean;
  onEdit: (index: number) => void;
  onAte: (index: number) => void;
  onClear: (index: number) => void;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const doneCount = habits.filter((h) => h.done).length;
  const pending = habits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.status == null)
    .sort((a, b) => rankOf(a.h.label) - rankOf(b.h.label));
  const nextIndex = pending.length ? pending[0]!.i : null;
  const todayWeekday = (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
  const homeCtx = homePlanner ? { ...homePlanner, weekday: todayWeekday } : null;

  // Peques de triturados a los que les falta su puré HOY en el plan — pasa
  // cuando se dan de alta o cambian de etapa después de generar el plan del
  // mes. Dispara el aviso "Actualizar" (`ChildMealGapBanner`).
  const householdBaseline = household?.household?.shared_slots ?? EMPTY_SCHEDULE;
  const pendingKidMeals = (household?.children ?? []).filter(
    (c) =>
      c.feeding_stage === "triturados" &&
      childPureeGaps(
        plan,
        { id: c.id, stage: c.feeding_stage, homeSchedule: c.home_schedule ?? householdBaseline },
        date,
      ).some((g) => g.date === date),
  );

  const fillKidsMut = useMutation({
    mutationFn: () =>
      apiPost<{ plan: MonthlyPlan; filled: number; children: string[] }>("plan/child-meal-fill", {
        today: date,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      Alert.alert(
        res.filled
          ? t("hoy.kids.updated", { names: res.children.join(", ") })
          : t("hoy.kids.upToDate"),
      );
    },
    onError: (e) => Alert.alert(e instanceof Error ? e.message : t("hoy.kids.failed")),
  });

  return (
    <View className="mt-6">
      <View className="mb-3.5 flex-row items-baseline justify-between">
        <Text
          className="font-heading text-foreground"
          style={{ fontSize: 21, lineHeight: 22, letterSpacing: -0.4 }}
        >
          {t("hoy.meals.title")}
        </Text>
        <Text className="font-mono-medium text-[11px] text-muted-foreground">
          {t("hoy.meals.count", { done: doneCount, total: habits.length })}
        </Text>
      </View>

      <ChildMealGapBanner
        names={pendingKidMeals.map((c) => c.name)}
        pending={fillKidsMut.isPending}
        onUpdate={() => fillKidsMut.mutate()}
      />

      {!habits.length ? (
        noPlanYet ? (
          // Un mes se genera una vez, tras la conversación con el coach en
          // Plan: aquí no se genera nada, solo se lleva allí.
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate("/plan")}
            className="flex-row items-center gap-3 rounded-[20px] bg-surface p-4 active:opacity-80"
          >
            <View className="h-10 w-10 items-center justify-center rounded-full bg-primary-soft">
              <CalendarRange size={20} color="#a84a17" />
            </View>
            <View className="flex-1">
              <Text className="font-body-semibold text-sm text-foreground">
                {t("hoy.meals.noPlanTitle")}
              </Text>
              <Text className="font-body text-xs text-muted-foreground">
                {t("hoy.meals.noPlanBody")}
              </Text>
            </View>
            <ChevronRight size={16} color="#6b6256" />
          </Pressable>
        ) : (
          <View className="rounded-[20px] bg-surface p-4">
            {loadFailed ? (
              <Pressable accessibilityRole="button" onPress={() => onRetry()}>
                <Text className="font-body-medium text-sm text-primary-ink">
                  {t("hoy.meals.loadFailed")}
                </Text>
              </Pressable>
            ) : (
              <Text className="font-body text-sm text-muted-foreground">
                {t("hoy.meals.loading")}
              </Text>
            )}
          </View>
        )
      ) : (
        <View className="gap-2.5">
          {habits.map((h, i) => {
            const isNext = i === nextIndex;
            const isDone = h.status === "plan" || h.status === "distinto";
            const isSkip = h.status === "salteo";
            const isPending = h.status == null;
            const planned = todayMeals.find((m) => m.moment === h.label);
            const dish = planned?.idea || h.label;
            const cat = classifyDish(dish);
            const catInfo = FOOD_CATEGORIES[cat];
            const accent = catInfo.accent;
            // El plato de este momento se ha cambiado hoy: el real en
            // naranja y debajo, tachada, la sugerencia ORIGINAL del plan
            // — congelada, así que sigue igual tras veinte cambios (ver
            // `plannedIdea` en lib/plan-shared.ts).
            const wasIdea = suggestedDish(h, dish);
            // Sin receta si el plato ya se cambió a mano: ya se sabe qué se
            // va a comer, así que enseñarla solo gastaría una llamada a la
            // IA sin aportar nada. Solo cuenta para quien de verdad lo
            // cambió (`dishChangeIsMine`), no para el resto del hogar.
            const mealKeyForPin = MOMENT_TO_MEAL_KEY[h.label] ?? "snack";
            const hideRecipe = !!wasIdea && dishChangeIsMine(mealKeyForPin, homeCtx);
            const note = offListNote(planned?.off, t);
            // D13: un plato sin cifra se dice, no se rellena con un promedio.
            const mealNumbers = mealMacros?.find((m) => m.moment === h.label && m.idea === dish);
            // Sin cifras a la vista, "Calculando…" no dice nada; el aviso de
            // texto vago sí (le pide concretar).
            const calculating =
              !!planned?.idea &&
              mealNumbers?.status === "calculando" &&
              (showNumbers || !!mealNumbers.vague);

            return (
              <View
                key={h.label}
                className="rounded-[20px] px-3.5 py-3"
                style={{
                  backgroundColor: isSkip
                    ? "#f0ede7"
                    : isDone
                      ? "#e1f2e4"
                      : tintBg(accent, isNext ? 22 : 13),
                  opacity: isSkip ? 0.55 : 1,
                }}
              >
                <View className="flex-row items-center" style={{ columnGap: 12 }}>
                  {/* Icono de categoría de comida (familia Lucide, igual que
                      la subpestaña Ingredientes). Sin plato aún o categoría
                      "otro" → círculo solo con el tinte. */}
                  <View
                    className="h-10 w-10 items-center justify-center overflow-hidden rounded-full"
                    style={{ backgroundColor: tintBg(accent, 20) }}
                  >
                    {planned?.idea ? <DishCategoryIcon dish={dish} size={18} /> : null}
                  </View>

                  {/* Info */}
                  <View className="min-w-0 flex-1">
                    <View className="flex-row items-baseline gap-1.5">
                      <Text className="font-body-semibold text-[11.5px] text-foreground">
                        {t(`moments.${h.label}`, { defaultValue: h.label })}
                      </Text>
                      {planned ? (
                        <Text className="font-mono text-[10.5px] text-muted-foreground">
                          {MOMENT_RANK[h.label] === 0
                            ? "8:30"
                            : MOMENT_RANK[h.label] === 1
                              ? "14:00"
                              : MOMENT_RANK[h.label] === 3
                                ? "20:30"
                                : "17:00"}
                        </Text>
                      ) : null}
                    </View>
                    <Text
                      className="font-heading-medium mt-1 text-foreground"
                      style={{
                        fontSize: 16.5,
                        lineHeight: 20,
                        letterSpacing: -0.3,
                        color: isSkip ? "#6b6256" : wasIdea ? "#a84a17" : "#3e3d39",
                      }}
                      numberOfLines={2}
                    >
                      {dish}
                    </Text>
                    {wasIdea ? (
                      <Text
                        className="mt-0.5 font-body text-[11.5px] text-muted-foreground"
                        style={{ textDecorationLine: "line-through" }}
                        numberOfLines={2}
                      >
                        {wasIdea}
                      </Text>
                    ) : null}
                    {calculating ? (
                      <View className="mt-1 flex-row items-center gap-1">
                        {mealNumbers?.vague ? null : (
                          <ActivityIndicator size="small" color="#6b6256" />
                        )}
                        <Text className="font-body text-[11px] text-muted-foreground">
                          {mealNumbers?.vague ? t("hoy.meals.vague") : t("hoy.meals.calculating")}
                        </Text>
                      </View>
                    ) : null}
                    <Text className="font-mono-medium mt-1 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                      {catInfo.label}
                    </Text>
                  </View>

                  {/* Acciones */}
                  <View className="flex-row items-center gap-1.5">
                    {/* Spinner mientras esta comida espera al lote del
                        día. Es por comida, no global: cambiar una no
                        bloquea las demás. El RESULTADO del ajuste ya no se
                        enseña aquí — lo movido lo decide el día entero, así
                        que atribuirlo a una comida era mentira: el servidor
                        escribía la misma lista en todas las del lote. Vive
                        en `DayBalanceCard`. */}
                    {isAdjusting(h.label) ? (
                      <View className="h-[26px] w-[26px] items-center justify-center rounded-full bg-primary/10">
                        <ActivityIndicator size="small" color="#a84a17" />
                      </View>
                    ) : null}
                    {isPending ? (
                      <>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("hoy.meals.ateOtherLabel", {
                            meal: t(`moments.${h.label}`, { defaultValue: h.label }),
                          })}
                          hitSlop={7}
                          onPress={() => onEdit(i)}
                          className="h-[30px] w-[30px] items-center justify-center rounded-full bg-surface active:opacity-80"
                        >
                          <PencilLine size={14} color="#6b6256" />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t("hoy.meals.ateThisLabel", {
                            meal: t(`moments.${h.label}`, { defaultValue: h.label }),
                          })}
                          hitSlop={5}
                          onPress={() => onAte(i)}
                          className="h-[34px] w-[34px] items-center justify-center rounded-full active:opacity-80"
                          style={{ backgroundColor: accent }}
                        >
                          <Check size={17} color="#fbfaf7" strokeWidth={2.6} />
                        </Pressable>
                      </>
                    ) : isDone ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("hoy.meals.undoLabel", {
                          meal: t(`moments.${h.label}`, { defaultValue: h.label }),
                        })}
                        hitSlop={5}
                        onPress={() => onClear(i)}
                        className="h-[34px] w-[34px] items-center justify-center rounded-full bg-success"
                      >
                        <Undo2 size={15} color="#fbfaf7" strokeWidth={2.4} />
                      </Pressable>
                    ) : isSkip ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("hoy.meals.undoLabel", {
                          meal: t(`moments.${h.label}`, { defaultValue: h.label }),
                        })}
                        hitSlop={5}
                        onPress={() => onClear(i)}
                        className="h-[34px] w-[34px] items-center justify-center rounded-full bg-secondary"
                      >
                        <X size={15} color="#6b6256" strokeWidth={2.2} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>

                {/* Aviso de fuera de compra, base compartida y receta van
                    siempre a la vista, no tras un toque oculto — igual que en
                    la web. La receta es un disclosure con su propio
                    abrir/cerrar y carga perezosa (DishRecipe). */}
                {note ? (
                  <View className="mt-3 self-start rounded-full bg-warning/20 px-2 py-0.5">
                    <Text className="font-body-medium text-[11px] text-foreground">{note}</Text>
                  </View>
                ) : null}
                {(() => {
                  const comp = mealCompanions(household, sharedSlots, h.label, todayWeekday);
                  if (!comp) return null;
                  const hasOthers = comp.others.length > 0;
                  return (
                    <View className="mt-2 flex-row items-center gap-2">
                      {comp.meHome ? (
                        <Home size={14} color="#6b6256" />
                      ) : (
                        <Briefcase size={14} color="#6b6256" />
                      )}
                      {hasOthers ? (
                        <>
                          <View className="flex-row" style={{ marginLeft: -2 }}>
                            {comp.others.slice(0, 4).map((p) => {
                              const colors = personColor(p.id);
                              return (
                                <View
                                  key={p.id}
                                  className="h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-background"
                                  style={{
                                    backgroundColor: colors.soft,
                                    marginLeft: -3,
                                  }}
                                >
                                  <Text
                                    style={{
                                      fontSize: 9,
                                      fontWeight: "700",
                                      color: colors.ink,
                                    }}
                                  >
                                    {p.displayName.charAt(0)}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                          <Text className="font-body text-[11px] text-muted-foreground">
                            {t("hoy.meals.sharedBase")}
                          </Text>
                        </>
                      ) : comp.meHome ? (
                        <Text className="font-body text-[11px] text-muted-foreground">
                          {t("hoy.meals.atHome")}
                        </Text>
                      ) : (
                        <Text className="font-body text-[11px] text-muted-foreground">
                          {t("hoy.meals.away")}
                        </Text>
                      )}
                    </View>
                  );
                })()}
                {childMealsFor(household, plan, date, h.label).map((k) => (
                  <View key={`${k.name}-${k.dish}`} className="mt-2">
                    <Text className="font-body text-[11px] leading-relaxed text-muted-foreground">
                      {t("hoy.meals.forChild", { name: k.name })}{" "}
                      <Text className="text-foreground">{k.dish}</Text>
                      {offListNote(k.off, t) ? ` · ${offListNote(k.off, t)}` : ""}
                    </Text>
                    <DishRecipe dish={k.dish} month={month} />
                  </View>
                ))}
                {planned?.idea && !hideRecipe ? <DishRecipe dish={dish} month={month} /> : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
