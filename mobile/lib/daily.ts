import { supabase } from "./supabase";
import type { MonthlyPlan, ShoppingList, TripActuals, TripConfirmations } from "./plan-shared";

/**
 * Acceso a los datos del día, equivalente móvil de `src/lib/daily.ts` de la web.
 * Son consultas normales a Supabase: lo que protege los datos son las políticas
 * RLS del proyecto, las mismas por las que pasa la web.
 *
 * Ojo: esto es una copia, no código compartido. Los tipos siguen el esquema de
 * `src/integrations/supabase/types.ts`; si cambia una tabla, hay que tocarlo en
 * los dos sitios (ver AGENTS.md).
 */

export type Profile = {
  id: string;
  display_name: string | null;
  age: number | null;
  date_of_birth: string | null;
  height_cm: number | null;
  start_weight_kg: number | null;
  current_weight_kg: number | null;
  activity_level: string | null;
  goal_type: string | null;
  goal_amount: number | null;
  goal_target_date: string | null;
  restrictions: string | null;
  meal_schedule: string | null;
  life_context: string | null;
  family_context: string | null;
  budget_month_eur: number | null;
  sex: string | null;
  medical_conditions: string | null;
  medications: string | null;
  exercise: string | null;
  work_schedule: string | null;
  wake_time: string | null;
  sleep_time: string | null;
  meals_per_day: number | null;
  diet_pattern: string | null;
  non_negotiable_foods: string | null;
  food_relationship: string | null;
  short_term_goal: string | null;
  past_struggles: string | null;
  coach_scope: string | null;

  tone: string;
  morning_time: string;
  evening_time: string;
  theme: string;
  onboarding_completed: boolean;
};

export type MacroEstimate = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

/** Estimación de macros de un plato concreto de hoy — ver `mealMacros` abajo. */
export type MealMacroEstimate = MacroEstimate & { moment: string };

export type DailyGuide = {
  intro: string;
  calories: string;
  macros: string;
  /** null cuando aún no hay platos reales de hoy (sin plan) de los que partir. */
  macroEstimate?: MacroEstimate | null;
  /** Estimación por plato de hoy, para sumar solo lo ya marcado como comido
   * (ver `MacroBars` en Hoy) en vez de todo el menú del día de golpe. */
  mealMacros?: MealMacroEstimate[] | null;
  behaviors: string[];
  meals?: { moment: string; idea: string }[];
  tips?: string[];
};

export type MealStatus = "plan" | "distinto" | "salteo";

export const MEAL_STATUS_LABEL: Record<MealStatus, string> = {
  plan: "Comí lo del plan",
  distinto: "Comí distinto",
  salteo: "Me lo salté",
};

export type DailyLog = {
  id: string;
  user_id: string;
  log_date: string;
  weight_kg: number | null;
  habits: { label: string; done: boolean; status?: MealStatus }[];
  guide: DailyGuide | null;
  mood: string | null;
  notes: string | null;
  evening_done: boolean;
};

/** Fecha local, no UTC: `toISOString()` cambia de día por la noche en España. */
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function fetchProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export async function saveProfile(patch: Partial<Profile>) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sin sesión");
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: auth.user.id, ...patch } as never, { onConflict: "id" });
  if (error) throw error;
}

export async function fetchLogs(): Promise<DailyLog[]> {
  const { data, error } = await supabase
    .from("daily_logs")
    .select("*")
    .order("log_date", { ascending: false })
    .limit(120);
  if (error) throw error;
  return (data ?? []) as unknown as DailyLog[];
}

export async function ensureTodayLog(habits: string[]): Promise<DailyLog> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sin sesión");
  const date = todayISO();

  const { data: existing } = await supabase
    .from("daily_logs")
    .select("*")
    .eq("log_date", date)
    .maybeSingle();
  if (existing) return existing as unknown as DailyLog;

  const { data, error } = await supabase
    .from("daily_logs")
    .insert({
      user_id: auth.user.id,
      log_date: date,
      habits: habits.map((label) => ({ label, done: false })),
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as DailyLog;
}

export async function updateTodayLog(patch: Partial<DailyLog>) {
  const { error } = await supabase
    .from("daily_logs")
    .update(patch as never)
    .eq("log_date", todayISO());
  if (error) throw error;
}

export type ChatMessage = {
  id: string;
  log_date: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

/** Guarda un mensaje en el historial de chat del día de hoy (mismo backend que la web). */
export async function addMessage(role: "user" | "assistant", content: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sin sesión");
  const { error } = await supabase
    .from("chat_messages")
    .insert({ user_id: auth.user.id, role, content, log_date: todayISO() } as never);
  if (error) throw error;
}

/** Historial de chat de un día concreto, en orden cronológico. */
export async function fetchMessages(date: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("log_date", date)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ChatMessage[];
}

// --- Plan mensual (solo lectura, lo que Hoy necesita) ---

export type MonthlyPlanRow = {
  id: string;
  month: string;
  plan: MonthlyPlan | null;
  shopping: ShoppingList | null;
  confirmed_at: string | null;
  trip_actuals: TripActuals | null;
  confirmed_trips: TripConfirmations | null;
};

/** Mes actual en formato YYYY-MM, para la clave del plan mensual. */
export const monthISO = () => todayISO().slice(0, 7);

export async function fetchMonthlyPlan(month: string): Promise<MonthlyPlanRow | null> {
  const { data, error } = await supabase
    .from("monthly_plans")
    .select("id, month, plan, shopping, confirmed_at, trip_actuals, confirmed_trips")
    .eq("month", month)
    .maybeSingle();

  if (error) {
    // Compatibilidad hacia atrás: si la migración de confirmed_trips todavía
    // no se ha aplicado en la base de datos, esa columna no existe y esta
    // consulta falla entera. Reintenta sin ella para no tumbar toda la
    // pestaña Plan mientras tanto; en cuanto la migración esté aplicada, el
    // primer intento vuelve a funcionar solo.
    const retry = await supabase
      .from("monthly_plans")
      .select("id, month, plan, shopping, confirmed_at, trip_actuals")
      .eq("month", month)
      .maybeSingle();
    if (retry.error) throw retry.error;
    return retry.data
      ? { ...(retry.data as unknown as MonthlyPlanRow), confirmed_trips: null }
      : null;
  }
  return (data as unknown as MonthlyPlanRow | null) ?? null;
}

// --- Señales de progreso (impulso, tendencia semanal, semáforo) ---

export type RatioSignal = "success" | "warning" | "muted" | "none";

/**
 * Semáforo de cumplimiento diario, compartido por WeekStrip y MonthCalendar.
 * Deliberadamente sin rojo: un día flojo se marca "muted" (gris neutro), nunca
 * como fallo. "none" es solo para días sin ningún registro.
 */
export function ratioSignal(done: number, total: number): RatioSignal {
  if (!total) return "none";
  const ratio = done / total;
  if (ratio >= 1) return "success";
  if (ratio > 0) return "warning";
  return "muted";
}

function dailyRatio(log: DailyLog | undefined) {
  const habits = log?.habits ?? [];
  return habits.length ? habits.filter((h) => h.done).length / habits.length : 0;
}

/**
 * "Impulso": indicador de racha suave que nunca resetea a cero. Es una media
 * móvil exponencial (EMA) del cumplimiento diario expresada en 0-100: un día
 * flojo la hace bajar, no la borra; unos días buenos la recuperan rápido.
 * `days` limita cuánto histórico pesa (por defecto, las últimas 3 semanas).
 */
export function impulsoFrom(logs: DailyLog[], days = 21): number {
  const sorted = [...logs].sort((a, b) => (a.log_date < b.log_date ? -1 : 1)).slice(-days);
  if (!sorted.length) return 0;
  const alpha = 0.25;
  let impulso = 0;
  for (const log of sorted) {
    impulso = alpha * (dailyRatio(log) * 100) + (1 - alpha) * impulso;
  }
  return Math.round(impulso);
}

export type WeeklyTrend = { thisWeek: number; lastWeek: number; deltaPts: number };

/**
 * Compara el cumplimiento medio de los últimos 7 días con el de los 7
 * anteriores. Devuelve null si no hay al menos 2 días registrados en cada una
 * de las dos semanas para que la comparación signifique algo.
 */
export function weeklyTrendFrom(logs: DailyLog[]): WeeklyTrend | null {
  const todayStr = todayISO();
  const byDate = new Map(logs.map((l) => [l.log_date, l]));
  const avgRatioFor = (offsetStart: number, offsetEnd: number) => {
    const d = new Date(`${todayStr}T00:00:00`);
    let sum = 0;
    let counted = 0;
    for (let i = offsetStart; i < offsetEnd; i++) {
      const day = new Date(d);
      day.setDate(d.getDate() - i);
      const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      const log = byDate.get(iso);
      if (!log || !(log.habits ?? []).length) continue;
      sum += dailyRatio(log);
      counted += 1;
    }
    return counted >= 2 ? sum / counted : null;
  };

  const thisWeek = avgRatioFor(0, 7);
  const lastWeek = avgRatioFor(7, 14);
  if (thisWeek == null || lastWeek == null) return null;
  return {
    thisWeek: Math.round(thisWeek * 100),
    lastWeek: Math.round(lastWeek * 100),
    deltaPts: Math.round(thisWeek * 100) - Math.round(lastWeek * 100),
  };
}

/**
 * Progreso hacia el objetivo de peso, en 0-1 y en kg. "Mantener" mide la
 * estabilidad (cuánto te has alejado del peso inicial, hasta 3 kg de margen).
 */
export function goalProgress(profile: Profile | null) {
  if (!profile || !profile.goal_type) return { pct: 0, done: 0, total: 0, unit: "kg" };
  const start = Number(profile.start_weight_kg ?? 0);
  const current = Number(profile.current_weight_kg ?? start);
  const total = Number(profile.goal_amount ?? 0);
  if (profile.goal_type === "mantener" || total <= 0) {
    const drift = Math.abs(current - start);
    return { pct: Math.max(0, Math.min(1, 1 - drift / 3)), done: drift, total: 0, unit: "kg" };
  }
  const done = profile.goal_type === "perder" ? start - current : current - start;
  return {
    pct: Math.max(0, Math.min(1, done / total)),
    done: Math.max(0, done),
    total,
    unit: "kg",
  };
}

/**
 * Corrección retroactiva de un día pasado (historial). Solo toca el registro
 * personal; nunca reescribe la compra ya confirmada de ese mes. El día de hoy
 * se corrige desde la pestaña Hoy, no aquí.
 */
export async function updateLogByDate(date: string, patch: Partial<DailyLog>) {
  if (date >= todayISO()) throw new Error("Solo se pueden corregir días pasados");
  const { data, error } = await supabase
    .from("daily_logs")
    .update(patch as never)
    .eq("log_date", date)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) throw new Error("No se ha podido guardar la corrección");
}
