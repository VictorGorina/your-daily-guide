import { supabase } from "./supabase";

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

export type DailyGuide = {
  intro: string;
  calories: string;
  macros: string;
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
