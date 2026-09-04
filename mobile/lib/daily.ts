import { cleanSharedSlots, type SharedSlots } from "./household-shared";
import { composeMonthlyPlanForMember, mealsForDate } from "./plan-shared";
import { supabase } from "./supabase";
import type {
  MonthlyPlan,
  PantryExtra,
  ShoppingList,
  TripActuals,
  TripConfirmations,
  TripReceipts,
} from "./plan-shared";

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

  pregnancy_status: string | null;
  menstrual_cycle: string | null;
  ed_history: string | null;
  alcohol: string | null;
  allergy_severity: string | null;
  disliked_foods: string | null;
  cuisine_preference: string | null;
  portions_per_meal: string | null;
  meals_to_plan: string | null;
  kitchen_equipment: string | null;
  cooking_skill: string | null;
  strength_training_experience: string | null;
  supplements: string | null;
  smoking: string | null;
  tracking_experience: string | null;
  weigh_in_cadence: string | null;

  tone: string;
  morning_time: string;
  evening_time: string;
  theme: string;
  /** Idioma de la interfaz y del coach ('es' | 'en'). */
  locale: string;
  /** Zona horaria IANA detectada del dispositivo; la usa el push del servidor. */
  timezone: string;
  /** País elegido en el onboarding (ISO-3166 alpha-2), o null en perfiles previos. */
  country: string | null;
  /** Moneda para formatear importes ('EUR' | 'GBP' | 'USD'...). */
  currency: string;
  onboarding_completed: boolean;
  /** Fecha de alta en la app (se fija al completar el onboarding). Suelo del
   * navegador de meses de la pantalla Plan; antes de esta fecha no hay nada. */
  app_started_on: string | null;
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
  habits: {
    label: string;
    done: boolean;
    status?: MealStatus;
    /** Plato que había en el plan antes de que el coach lo cambiara por lo que
     * de verdad se comió ese momento (ver `cambiar_plato` en
     * use-coach-actions.ts). Solo se guarda la primera vez que se cambia ese
     * momento en el día. Mismo criterio que la web (src/lib/daily.ts). */
    wasIdea?: string;
  }[];
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

/**
 * Registros de un mes concreto ("YYYY-MM"), para los semáforos del calendario
 * del mes seleccionado en Plan sin depender del límite de 120 días de
 * `fetchLogs` (que solo cubre ~4 meses hacia atrás).
 */
export async function fetchLogsForMonth(month: string): Promise<DailyLog[]> {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y ?? 1970, m ?? 1, 0).getDate();
  const { data, error } = await supabase
    .from("daily_logs")
    .select("*")
    .gte("log_date", `${month}-01`)
    .lte("log_date", `${month}-${String(lastDay).padStart(2, "0")}`)
    .order("log_date", { ascending: true });
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
  pantry_extras: PantryExtra[] | null;
  trip_receipts: TripReceipts | null;
};

/** Mes actual en formato YYYY-MM, para la clave del plan mensual. */
export const monthISO = () => todayISO().slice(0, 7);

async function fetchOwnMonthlyPlan(
  month: string,
  userId: string | null,
): Promise<MonthlyPlanRow | null> {
  // Se filtra por `user_id` explícitamente: desde issue 05 hay una policy de
  // SELECT que también deja a un miembro del hogar leer la fila del
  // planificador, así que un `.maybeSingle()` sin ese filtro devolvería 2 filas
  // (PGRST116) para un no planificador. Sin sesión, RLS ya no deja ver nada.
  const { data, error } = await supabase
    .from("monthly_plans")
    .select(
      "id, month, plan, shopping, confirmed_at, trip_actuals, confirmed_trips, pantry_extras, trip_receipts",
    )
    .eq("month", month)
    .eq("user_id", userId ?? "")
    .maybeSingle();

  if (error) {
    // Compatibilidad hacia atrás: si alguna migración reciente (confirmed_trips,
    // pantry_extras, trip_receipts) todavía no se ha aplicado, esa columna no
    // existe y la consulta falla entera. Reintenta con el set mínimo seguro
    // para no tumbar toda la pestaña Plan mientras tanto.
    // Si no es un error de columna (PGRST204), lo propagamos directamente.
    const isColumnError = typeof error === "object" && "code" in error && error.code === "PGRST204";
    if (!isColumnError) throw error;
    console.warn("fetchOwnMonthlyPlan: columna faltante, reintentando con set mínimo", error);
    const retry = await supabase
      .from("monthly_plans")
      .select("id, month, plan, shopping, confirmed_at, trip_actuals")
      .eq("month", month)
      .eq("user_id", userId ?? "")
      .maybeSingle();
    if (retry.error) throw retry.error;
    return retry.data
      ? {
          ...(retry.data as unknown as MonthlyPlanRow),
          confirmed_trips: null,
          pantry_extras: null,
          trip_receipts: null,
        }
      : null;
  }
  return (data as unknown as MonthlyPlanRow | null) ?? null;
}

/** Quién planifica en tu hogar y qué comidas comparte, en una sola consulta. */
async function householdPlanInfo(
  userId: string,
): Promise<{ plannerId: string; sharedSlots: SharedSlots } | null> {
  const { data } = await supabase.rpc("household_plan_context", { _user_id: userId });
  const row = (Array.isArray(data) ? data[0] : data) as
    { planner_id: string | null; shared_slots: unknown } | undefined;
  if (!row?.planner_id) return null;
  return { plannerId: row.planner_id, sharedSlots: cleanSharedSlots(row.shared_slots) };
}

/**
 * El plan del mes tal y como lo ve la persona: si vive en un hogar y no es
 * quien planifica, las comidas compartidas (issue 03) se componen en vivo con
 * la fila del planificador (issue 05, D1) — incluso si ella todavía no ha
 * planificado nada suyo, para que nunca vea "sin plan" en lo que ya cubre la
 * casa. Sus comidas en solitario siguen siendo las de su propia fila.
 */
export async function fetchMonthlyPlan(month: string): Promise<MonthlyPlanRow | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  const [row, info] = await Promise.all([
    fetchOwnMonthlyPlan(month, userId),
    userId ? householdPlanInfo(userId) : Promise.resolve(null),
  ]);
  if (!info || info.plannerId === userId) return row;

  const { data: plannerRow } = await supabase
    .from("monthly_plans")
    .select("plan")
    .eq("user_id", info.plannerId)
    .eq("month", month)
    .maybeSingle();
  const plannerPlan =
    ((plannerRow as { plan: unknown } | null)?.plan as MonthlyPlan | null) ?? null;
  const composed = composeMonthlyPlanForMember(row?.plan ?? null, plannerPlan, info.sharedSlots);
  if (!composed) return row;
  return row
    ? { ...row, plan: composed }
    : {
        id: "",
        month,
        plan: composed,
        shopping: null,
        confirmed_at: null,
        trip_actuals: null,
        confirmed_trips: null,
        pantry_extras: null,
        trip_receipts: null,
      };
}

export type PlannerShoppingRow = {
  plannerId: string;
  plan: MonthlyPlan | null;
  shopping: ShoppingList | null;
  pantry_extras: PantryExtra[] | null;
  trip_actuals: TripActuals | null;
  trip_receipts: TripReceipts | null;
  confirmed_trips: TripConfirmations | null;
  confirmed_at: string | null;
};

/**
 * La compra del hogar — la fila `monthly_plans` del planificador — para un
 * miembro que NO es quien planifica. `null` si vive sin hogar, si es el propio
 * planificador o si el planificador aún no tiene plan de ese mes. La lectura la
 * permite la policy RLS de issue 05. En issue 05 la pestaña Ingredientes la
 * muestra en solo lectura; el estado de compra se hace editable en issue 06.
 */
export async function fetchPlannerShopping(month: string): Promise<PlannerShoppingRow | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;
  if (!userId) return null;
  const info = await householdPlanInfo(userId);
  if (!info || info.plannerId === userId) return null;

  const { data, error } = await supabase
    .from("monthly_plans")
    .select(
      "plan, shopping, pantry_extras, trip_actuals, trip_receipts, confirmed_trips, confirmed_at",
    )
    .eq("user_id", info.plannerId)
    .eq("month", month)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as Omit<PlannerShoppingRow, "plannerId">;
  return { plannerId: info.plannerId, ...row };
}

/**
 * Anota el peso de hoy: en el registro del día (`daily_logs.weight_kg`) y como
 * peso actual del perfil (`profiles.current_weight_kg`) — el mismo par que
 * escribe el coach en `actualizar_peso`, para que Hoy, el objetivo y la
 * tendencia queden coherentes por un único camino.
 *
 * Si el registro de hoy todavía no existe (p. ej. se entra directo a la
 * pestaña Plan sin pasar por Hoy), se crea con las comidas reales del plan del
 * mes en curso — nunca con `[]` — porque un registro con `habits` vacío deja
 * Hoy con "Preparando las comidas de hoy..." colgado (ver `ensureTodayLog`).
 */
export async function logTodayWeight(kg: number) {
  if (!Number.isFinite(kg) || kg < 25 || kg > 400) {
    throw new Error("El peso debe estar entre 25 y 400 kg");
  }
  const { data, error } = await supabase
    .from("daily_logs")
    .update({ weight_kg: kg } as never)
    .eq("log_date", todayISO())
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    const planRow = await fetchMonthlyPlan(monthISO());
    const moments = mealsForDate((planRow?.plan as MonthlyPlan | null) ?? null, todayISO()).map(
      (m) => m.moment,
    );
    await ensureTodayLog(moments);
    await updateTodayLog({ weight_kg: kg });
  }
  await saveProfile({ current_weight_kg: kg });
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
