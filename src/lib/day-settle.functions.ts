import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DayOutcome } from "@/lib/day-balance";
import type { MealChange } from "@/lib/plan-shared";
import { clampClientToday } from "@/lib/zoned-date";
import { createServerFn } from "@tanstack/react-start";
import { type DishChange, settleDayHandler, type SettleDayInput } from "./day-settle.server";

/** Cambios de plato como mucho por lote: un tope contra un bucle. */
const DISH_CHANGE_MAX = 10;

/** Lo que manda el cliente: una app móvil anterior al ticket 13 no manda proteína. */
type DishChangeInput = Omit<DishChange, "proteinDelta"> & { proteinDelta?: number | null };

/** Lo reservado en cada libro de cuentas, para poder devolverlo si algo falla. */
export type SettleDayResult = {
  outcome: DayOutcome;
  /** Desvío pendiente que se analizó, con signo. */
  kcal: number;
  changes?: MealChange[];
  summary?: string;
};

type ReflowMeals = typeof import("@/lib/plan/reflow.server").reflowMeals;

/** Lo que el handler recibe de fuera; los tests cambian `reflow` (sin IA). */
export type SettleDayDeps = { reflow?: ReflowMeals };

export const settleDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input?: { today?: string; changes?: DishChangeInput[] }): SettleDayInput => {
    const changes = (Array.isArray(input?.changes) ? input.changes : [])
      .slice(0, DISH_CHANGE_MAX)
      .map((c) => ({
        label: String(c?.label ?? "").slice(0, 60),
        slot: String(c?.slot ?? "").slice(0, 20),
        dish: String(c?.dish ?? "").slice(0, 200),
        plannedDish: String(c?.plannedDish ?? "").slice(0, 200),
        kcalDelta: Number.isFinite(Number(c?.kcalDelta)) ? Math.round(Number(c.kcalDelta)) : 0,
        proteinDelta:
          c?.proteinDelta != null && Number.isFinite(Number(c.proteinDelta))
            ? Math.round(Number(c.proteinDelta))
            : null,
      }))
      .filter((c) => c.label);
    return { today: clampClientToday(input?.today), changes };
  })
  .handler(({ data, context }) => settleDayHandler({ data, context }));
