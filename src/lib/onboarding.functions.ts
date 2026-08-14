import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COACH_MODEL, createAiProvider } from "@/lib/ai-provider.server";

export type OnboardingDraft = {
  display_name: string | null;
  age: number | null;
  date_of_birth: string | null;
  sex: string | null;
  height_cm: number | null;
  current_weight_kg: number | null;
  medical_conditions: string | null;
  medications: string | null;
  activity_level: string | null;
  exercise: string | null;
  work_schedule: string | null;
  wake_time: string | null;
  sleep_time: string | null;
  meals_per_day: number | null;
  diet_pattern: string | null;
  non_negotiable_foods: string | null;
  food_relationship: string | null;
  goal_type: string | null;
  goal_amount: number | null;
  goal_target_date: string | null;
  short_term_goal: string | null;
  past_struggles: string | null;
  restrictions: string | null;
  meal_schedule: string | null;
  life_context: string | null;
  family_context: string | null;
  budget_month_eur: number | null;
  coach_scope: string | null;
  tone: string | null;
  morning_time: string | null;
  evening_time: string | null;
};

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.toLowerCase() !== "null" ? s : null;
};
const time = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{2}:\d{2}$/.test(s) ? s : null;
};
const date = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

export const parseOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { transcript: string }) => ({
    transcript: String(input?.transcript ?? "").slice(0, 12000),
  }))
  .handler(async ({ data }): Promise<OnboardingDraft> => {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error("Falta la clave de IA");

    const ai = createAiProvider(key);
    const { text } = await generateText({
      model: ai(COACH_MODEL),
      system:
        "Extraes datos estructurados de una conversación de bienvenida en español. Nunca inventas: si algo no se dice, usa null.",
      prompt:
        `Conversación:\n${data.transcript}\n\n` +
        "Devuelve solo JSON válido con estas claves: " +
        '{"display_name": string|null, "age": number|null, "date_of_birth": "YYYY-MM-DD"|null, "sex": "hombre"|"mujer"|"otro"|null, "height_cm": number|null, "current_weight_kg": number|null, ' +
        '"medical_conditions": string|null, "medications": string|null, ' +
        '"activity_level": "sedentario"|"ligero"|"activo"|"muy activo"|null, "exercise": string (tipo y frecuencia)|null, ' +
        '"work_schedule": string|null, "wake_time": "HH:MM"|null, "sleep_time": "HH:MM"|null, "meals_per_day": number|null, ' +
        '"diet_pattern": string (omnívoro, vegetariano, vegano, sin gluten...)|null, "non_negotiable_foods": string|null, ' +
        '"food_relationship": string|null, ' +
        '"goal_type": "perder"|"mantener"|"ganar"|"habitos"|"energia"|null, "goal_amount": number|null, "goal_target_date": "YYYY-MM-DD"|null, ' +
        '"short_term_goal": string|null, "past_struggles": string|null, ' +
        '"restrictions": string (alergias e intolerancias)|null, ' +
        '"meal_schedule": string (muy concreto: qué días y comidas cocina en casa, qué come fuera o pide)|null, ' +
        '"life_context": string (resumen en 3-5 frases de su vida real: trabajo, horarios, deporte, sueño, estrés, tiempo para cocinar)|null, ' +
        '"family_context": string (con quién vive, qué comidas comparte y con quién, niños en casa con edades, alergias y cómo comen)|null, ' +
        '"budget_month_eur": number|null, ' +
        '"coach_scope": "comida"|"comida y hábitos"|null, ' +
        '"tone": "relajado"|"neutro"|"exigente"|null, "morning_time": "HH:MM"|null, "evening_time": "HH:MM"|null}. Sin markdown.',
    });

    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const p = JSON.parse(json) as Record<string, unknown>;
    return {
      display_name: str(p.display_name),
      age: num(p.age),
      date_of_birth: date(p.date_of_birth),
      sex: str(p.sex),
      height_cm: num(p.height_cm),
      current_weight_kg: num(p.current_weight_kg),
      medical_conditions: str(p.medical_conditions),
      medications: str(p.medications),
      activity_level: str(p.activity_level),
      exercise: str(p.exercise),
      work_schedule: str(p.work_schedule),
      wake_time: time(p.wake_time),
      sleep_time: time(p.sleep_time),
      meals_per_day: num(p.meals_per_day),
      diet_pattern: str(p.diet_pattern),
      non_negotiable_foods: str(p.non_negotiable_foods),
      food_relationship: str(p.food_relationship),
      goal_type: str(p.goal_type),
      goal_amount: num(p.goal_amount),
      goal_target_date: /^\d{4}-\d{2}-\d{2}$/.test(String(p.goal_target_date))
        ? String(p.goal_target_date)
        : null,
      short_term_goal: str(p.short_term_goal),
      past_struggles: str(p.past_struggles),
      restrictions: str(p.restrictions),
      meal_schedule: str(p.meal_schedule),
      life_context: str(p.life_context),
      family_context: str(p.family_context),
      budget_month_eur: num(p.budget_month_eur),
      coach_scope: str(p.coach_scope),
      tone: str(p.tone),
      morning_time: time(p.morning_time),
      evening_time: time(p.evening_time),
    };
  });
