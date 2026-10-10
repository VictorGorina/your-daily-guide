import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Briefcase,
  CalendarRange,
  Check,
  ChevronRight,
  Home,
  Loader2,
  PencilLine,
  Undo2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { ChildMealGapBanner } from "@/components/child-meal-gap-banner";
import { DishRecipe } from "@/components/dish-recipe";
import { DishCategoryIcon } from "@/components/food-category-bg";
import type { DailyGuide, DailyLog } from "@/lib/daily";
import { weekdayIndex } from "@/lib/dates";
import { classifyDish, FOOD_CATEGORIES } from "@/lib/food-categories";
import type { HouseholdState } from "@/lib/household";
import { EMPTY_SCHEDULE, personColor, type SharedSlots } from "@/lib/household-shared";
import {
  childPureeGaps,
  dishChangeIsMine,
  offListNote,
  suggestedDish,
  type mealsForDate,
  type MonthlyPlan,
} from "@/lib/plan-shared";
import { fillChildMeals } from "@/lib/plan.functions";
import {
  childMealsFor,
  mealCompanions,
  MOMENT_TIME,
  MOMENT_TO_MEAL_KEY,
  rankOf,
} from "@/lib/today-meals";

/** Tinte del acento de la categoría sobre la superficie del tema activo. */
const tint = (accent: string, pct: number) =>
  `color-mix(in oklab, ${accent} ${pct}%, var(--color-surface))`;

/**
 * Color legible encima de un acento de categoría. Los acentos claros (lácteos,
 * cereales, aves) dejarían invisible un check blanco, así que se decide por
 * luminancia. Son hex fijos, independientes del tema, por eso el par de
 * contraste también lo es.
 */
function onAccent(hex: string) {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return lum > 0.45 ? "#3e3d39" : "#fbfaf7";
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
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fillKids = useServerFn(fillChildMeals);
  // El momento se guarda en español canónico; aquí solo se pinta en el idioma.
  const mealName = (label: string) => t(`moments.${label}`, { defaultValue: label });
  const doneCount = habits.filter((h) => h.done).length;
  const todayWeekday = weekdayIndex(date);
  const homeCtx = homePlanner ? { ...homePlanner, weekday: todayWeekday } : null;

  // La "siguiente comida" es la primera, en orden cronológico, que aún no
  // tiene un estado explícito. Importante: se filtra por `status`, no por
  // `done` — "me lo salté" deja done:false a propósito (no cuenta como
  // hecho), pero sí queda resuelto, así que no debe seguir apareciendo como
  // "siguiente" ni bloquear para siempre el estado de "día completo" (ver
  // área 6 del roadmap UX, "casos límite").
  const pending = habits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.status == null)
    .sort((a, b) => rankOf(a.h.label) - rankOf(b.h.label));
  const nextIndex = pending.length ? pending[0].i : null;

  // El día se lee como una tira de arriba abajo, así que las comidas van en
  // orden cronológico aunque el plan las guarde en otro orden.
  const dayStrip = habits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => rankOf(a.h.label) - rankOf(b.h.label));

  // Peques de triturados a los que les falta su puré HOY en el plan — pasa
  // cuando se dan de alta o cambian de etapa después de generar el plan del
  // mes, porque solo la IA de `generateMonthlyPlan` rellena `days[].kids`.
  // Dispara el aviso de "Actualizar" (`ChildMealGapBanner`).
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
    mutationFn: () => fillKids({ data: { today: date } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      toast.success(
        res.filled
          ? t("hoy.kids.updated", { names: res.children.join(", ") })
          : t("hoy.kids.upToDate"),
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("hoy.kids.failed")),
  });

  return (
    <section className="animate-rise mt-6">
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 className="font-title text-[21px] font-semibold leading-none tracking-[-0.02em]">
          {t("hoy.meals.title")}
        </h2>
        {habits.length ? (
          <span className="font-num text-[11px] font-medium tabular-nums text-muted-foreground">
            {t("hoy.meals.count", { done: doneCount, total: habits.length })}
          </span>
        ) : null}
      </div>

      <ChildMealGapBanner
        names={pendingKidMeals.map((c) => c.name)}
        pending={fillKidsMut.isPending}
        onUpdate={() => fillKidsMut.mutate()}
      />

      {!habits.length ? (
        noPlanYet ? (
          // Un mes se genera una vez, tras la conversación con el coach en
          // Plan: aquí no se genera nada, solo se lleva allí.
          <Link
            to="/plan"
            className="surface-card mt-3.5 flex items-center gap-3 p-4 transition-transform active:scale-[0.99]"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-ink">
              <CalendarRange className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{t("hoy.meals.noPlanTitle")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("hoy.meals.noPlanBody")}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ) : loadFailed ? (
          <button
            type="button"
            onClick={() => onRetry()}
            className="mt-3.5 text-sm font-medium text-primary-ink"
          >
            {t("hoy.meals.loadFailed")}
          </button>
        ) : (
          <p className="mt-3.5 animate-pulse text-sm text-muted-foreground">
            {t("hoy.meals.loading")}
          </p>
        )
      ) : (
        <div className="mt-3.5 flex flex-col gap-2.5">
          {dayStrip.map(({ h, i }) => {
            const planned = todayMeals.find((m) => m.moment === h.label);
            const idea = planned?.idea ?? "";
            const cat = FOOD_CATEGORIES[classifyDish(idea)];
            const isNext = i === nextIndex;
            const isSkip = h.status === "salteo";
            const note = offListNote(planned?.off, t);
            const kidMeals = childMealsFor(household, plan, date, h.label);
            // El plato de este momento se ha cambiado hoy (desde el chat o
            // desde "comí otra cosa"): se muestra el real en naranja y debajo,
            // tachada, la sugerencia ORIGINAL del plan — congelada, así que
            // sigue siendo la misma tras veinte cambios (ver `plannedIdea` en
            // plan-shared.ts). Si se vuelve al plato sugerido, deja de contar
            // como editado.
            const wasIdea = suggestedDish(h, idea);
            // La receta solo se oculta si el cambio lo hizo la propia
            // persona: en un slot compartido, `wasIdea` también se dispara
            // cuando quien planifica cambia la comida de la casa después de
            // que esta persona ya vio el día — y no ha tocado nada ella.
            const mealKey = MOMENT_TO_MEAL_KEY[h.label] ?? "snack";
            const hideRecipe = !!wasIdea && dishChangeIsMine(mealKey, homeCtx);
            // D13: un plato sin cifra se dice, no se rellena con un promedio.
            const mealNumbers = mealMacros?.find((m) => m.moment === h.label && m.idea === idea);
            // Sin cifras a la vista, "Calculando…" no le dice nada a la persona;
            // el aviso de texto vago sí (le pide concretar).
            const calculating =
              !!idea &&
              mealNumbers?.status === "calculando" &&
              (showNumbers || !!mealNumbers.vague);

            return (
              <div
                key={h.label}
                className="rounded-[20px] px-3.5 py-3.5 transition-[background-color,opacity] duration-300"
                style={{
                  backgroundColor: isSkip
                    ? "var(--color-muted)"
                    : h.done
                      ? "var(--color-success-soft)"
                      : tint(cat.accent, isNext ? 22 : 13),
                  opacity: isSkip ? 0.55 : 1,
                }}
              >
                <div className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full"
                    style={{ backgroundColor: tint(cat.accent, 20) }}
                  >
                    {idea ? <DishCategoryIcon dish={idea} size={18} /> : null}
                  </span>

                  <div className="min-w-0">
                    <span className="flex items-baseline gap-[7px]">
                      <span className="text-[11.5px] font-semibold tracking-[0.01em]">
                        {mealName(h.label)}
                      </span>
                      {MOMENT_TIME[h.label] ? (
                        <span className="font-num text-[10.5px] text-muted-foreground">
                          {MOMENT_TIME[h.label]}
                        </span>
                      ) : null}
                    </span>
                    {/* El plato es el protagonista de la fila; cuando todavía
                        no hay menú, el hueco se rellena en pequeño y apagado
                        para no gritar lo que falta. */}
                    <span
                      className={`mt-1.5 block font-title tracking-[-0.02em] text-pretty ${
                        idea
                          ? `text-[16.5px] font-medium leading-tight ${
                              isSkip
                                ? "text-muted-foreground line-through"
                                : wasIdea
                                  ? "text-primary-ink"
                                  : "text-foreground"
                            }`
                          : "text-[13px] leading-snug text-muted-foreground"
                      }`}
                    >
                      {idea || t("hoy.meals.noMenu")}
                    </span>
                    {wasIdea ? (
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground line-through">
                        {wasIdea}
                      </span>
                    ) : null}
                    {calculating ? (
                      <span className="mt-1 flex items-center gap-1 text-[11px] leading-snug text-muted-foreground">
                        {mealNumbers?.vague ? (
                          t("hoy.meals.vague")
                        ) : (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t("hoy.meals.calculating")}
                          </>
                        )}
                      </span>
                    ) : null}
                    {classifyDish(idea) !== "otro" ? (
                      <span className="mt-1.5 block font-num text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {cat.label}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {/* Spinner mientras esta comida espera al lote del día.
                        Es por comida, no global: cambiar una no bloquea las
                        demás. El RESULTADO del ajuste ya no se enseña aquí —
                        lo movido lo decide el día entero, así que atribuirlo
                        a una comida era mentira: el servidor escribía la
                        misma lista en todas las del lote. Vive en
                        `DayBalanceCard`. */}
                    {isAdjusting(h.label) ? (
                      <span
                        className="grid h-[26px] w-[26px] place-items-center rounded-full bg-primary/10"
                        title={t("hoy.meals.adjusting")}
                      >
                        <Loader2 className="h-[14px] w-[14px] animate-spin text-primary-ink" />
                      </span>
                    ) : null}

                    {h.status == null ? (
                      <>
                        <button
                          type="button"
                          title={t("hoy.meals.ateOther")}
                          aria-label={t("hoy.meals.ateOtherLabel", { meal: mealName(h.label) })}
                          onClick={() => onEdit(i)}
                          className="grid h-[30px] w-[30px] place-items-center rounded-full bg-surface text-muted-foreground transition-transform active:scale-95"
                        >
                          <PencilLine className="h-[15px] w-[15px]" />
                        </button>
                        <button
                          type="button"
                          title={t("hoy.meals.ateThis")}
                          aria-label={t("hoy.meals.ateThisLabel", { meal: mealName(h.label) })}
                          onClick={() => onAte(i)}
                          className="grid h-[34px] w-[34px] place-items-center rounded-full transition-transform active:scale-95"
                          style={{
                            backgroundColor: cat.accent,
                            color: onAccent(cat.accent),
                          }}
                        >
                          <Check className="h-[17px] w-[17px]" strokeWidth={2.6} />
                        </button>
                      </>
                    ) : h.done ? (
                      <button
                        type="button"
                        title={t("hoy.meals.undo")}
                        aria-label={t("hoy.meals.undoLabel", { meal: mealName(h.label) })}
                        onClick={() => onClear(i)}
                        className="animate-pop grid h-[34px] w-[34px] place-items-center rounded-full bg-success text-success-foreground transition-transform active:scale-95"
                      >
                        <Undo2 className="h-[15px] w-[15px]" strokeWidth={2.4} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title={t("hoy.meals.undo")}
                        aria-label={t("hoy.meals.undoLabel", { meal: mealName(h.label) })}
                        onClick={() => onClear(i)}
                        className="grid h-[34px] w-[34px] place-items-center rounded-full bg-secondary text-muted-foreground transition-transform active:scale-95"
                      >
                        <X className="h-[15px] w-[15px]" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Aviso, base compartida y receta van siempre a la vista, no
                    tras un toque oculto sin pista — como en la app móvil. La
                    receta es un disclosure con su propio abrir/cerrar y carga
                    perezosa (DishRecipe). */}
                {note ? (
                  <span className="mt-3 inline-block rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {note}
                  </span>
                ) : null}
                {(() => {
                  const comp = mealCompanions(household, sharedSlots, h.label, todayWeekday);
                  if (!comp) return null;
                  const hasOthers = comp.others.length > 0;
                  return (
                    <div className="mt-2 flex items-center gap-2">
                      {comp.meHome ? (
                        <Home className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      {hasOthers ? (
                        <>
                          <span className="flex -space-x-1.5">
                            {comp.others.slice(0, 4).map((p) => {
                              const colors = personColor(p.id);
                              return (
                                <span
                                  key={p.id}
                                  title={p.displayName}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-background text-[9px] font-bold"
                                  style={{
                                    background: colors.soft,
                                    color: colors.ink,
                                  }}
                                >
                                  {p.displayName.charAt(0)}
                                </span>
                              );
                            })}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {t("hoy.meals.sharedBase")}
                          </span>
                        </>
                      ) : comp.meHome ? (
                        <span className="text-[11px] text-muted-foreground">
                          {t("hoy.meals.atHome")}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {t("hoy.meals.away")}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {kidMeals.map((k) => (
                  <div key={`${k.name}-${k.dish}`} className="mt-2">
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {t("hoy.meals.forChild", { name: k.name })}{" "}
                      <span className="text-foreground">{k.dish}</span>
                      {offListNote(k.off, t) ? ` · ${offListNote(k.off, t)}` : ""}
                    </p>
                    <DishRecipe dish={k.dish} month={month} />
                  </div>
                ))}
                {/* Sin receta si el plato ya se cambió a mano: ya se sabe qué
                    se va a comer, así que enseñarla solo gastaría una
                    llamada a la IA sin aportar nada. En un hogar compartido
                    esto solo se aplica a quien de verdad lo cambió
                    (`hideRecipe`), no al resto de miembros. */}
                {idea && !hideRecipe ? <DishRecipe dish={idea} month={month} /> : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
