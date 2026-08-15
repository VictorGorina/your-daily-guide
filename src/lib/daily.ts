import { supabase } from "@/integrations/supabase/client";

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

export type DailyGuide = {
  intro: string;
  calories: string;
  macros: string;
  behaviors: string[];
  meals?: { moment: string; idea: string }[];
  tips?: string[];
};

export type MonthlyPlanRow = {
  id: string;
  month: string;
  plan: import("@/lib/plan-shared").MonthlyPlan | null;
  shopping: import("@/lib/plan-shared").ShoppingList | null;
  confirmed_at: string | null;
};

export const monthISO = () => todayISO().slice(0, 7);

export async function fetchMonthlyPlan(month: string): Promise<MonthlyPlanRow | null> {
  const { data, error } = await supabase
    .from("monthly_plans")
    .select("id, month, plan, shopping, confirmed_at")
    .eq("month", month)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as MonthlyPlanRow | null) ?? null;
}

export type DailyLog = {
  id: string;
  user_id: string;
  log_date: string;
  weight_kg: number | null;
  habits: { label: string; done: boolean; status?: "plan" | "distinto" | "salteo" }[];
  guide: DailyGuide | null;
  mood: string | null;
  notes: string | null;
  evening_done: boolean;
};

export type ChatMessage = {
  id: string;
  log_date: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

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

export async function fetchMessages(date: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("*")
    .eq("log_date", date)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as ChatMessage[];
}

export async function fetchChatDays(): Promise<{ date: string; count: number }[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("log_date")
    .order("log_date", { ascending: false })
    .limit(600);
  if (error) throw error;
  const today = todayISO();
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as unknown as { log_date: string }[]) {
    if (row.log_date === today) continue;
    counts.set(row.log_date, (counts.get(row.log_date) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function addMessage(role: "user" | "assistant", content: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Sin sesión");
  const { error } = await supabase
    .from("chat_messages")
    .insert({ user_id: auth.user.id, role, content, log_date: todayISO() } as never);
  if (error) throw error;
}

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

export type RatioSignal = "success" | "warning" | "muted" | "none";

/**
 * Semáforo de cumplimiento diario, compartido por WeekStrip, MonthCalendar y
 * el mapa de calor de Historial. Deliberadamente sin rojo: un día flojo se
 * marca "muted" (gris neutro), nunca como fallo — ver área 5 del roadmap UX
 * ("motivación y retención"). "none" es solo para días sin ningún registro.
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
 * "Impulso": indicador de racha suave que nunca resetea a cero. Sustituye al
 * antiguo streakFrom (racha de días consecutivos por encima de un umbral,
 * donde un solo día flojo borraba toda la racha de golpe). En su lugar, es
 * una media móvil exponencial (EMA) del cumplimiento diario expresada en
 * 0-100: un día flojo la hace bajar, no la borra; unos días buenos la
 * recuperan rápido. `days` limita cuánto histórico pesa (por defecto, las
 * últimas 3 semanas).
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
 * anteriores, para dar feedback de tendencia semanal en vez de fijarse solo
 * en el cumplimiento de hoy. Devuelve null si no hay suficiente histórico en
 * alguna de las dos semanas para que la comparación signifique algo.
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
