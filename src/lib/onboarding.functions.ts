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
  // Seguridad: ver "Radiografía del onboarding". Cambian qué es seguro recomendar
  // o si hay que suavizar el tono numérico del coach.
  pregnancy_status: string | null;
  menstrual_cycle: string | null;
  ed_history: string | null;
  alcohol: string | null;
  allergy_severity: string | null;
  // Alto impacto diario: lo que el generador de plan usa cada mes tal cual, en vez
  // de tener que reinterpretarlo de life_context/meal_schedule cada vez.
  disliked_foods: string | null;
  cuisine_preference: string | null;
  portions_per_meal: string | null;
  meals_to_plan: string | null;
  kitchen_equipment: string | null;
  cooking_skill: string | null;
  // Refinamiento.
  strength_training_experience: string | null;
  supplements: string | null;
  smoking: string | null;
  tracking_experience: string | null;
  weigh_in_cadence: string | null;
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
  .validator((input: { transcript: string }) => ({
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
        '"tone": "relajado"|"neutro"|"exigente"|null, "morning_time": "HH:MM"|null, "evening_time": "HH:MM"|null, ' +
        '"pregnancy_status": "embarazada"|"lactancia"|"no"|"prefiere no decirlo"|null (solo si se ha preguntado), ' +
        '"menstrual_cycle": string (si el ciclo menstrual le afecta al apetito, energía o antojos, solo si se ha preguntado)|null, ' +
        '"ed_history": "activa"|"pasada"|"no"|"prefiere no decirlo"|null (relación con la comida: atracones, restricción severa, purgas), ' +
        '"alcohol": "nunca"|"ocasional"|"frecuente"|null, ' +
        '"allergy_severity": string (gravedad de sus alergias o intolerancias, si se ha dicho)|null, ' +
        '"disliked_foods": string (ingredientes que no le gustan o no quiere ver en sus platos, distinto de alergias)|null, ' +
        '"cuisine_preference": string (tipos de cocina o de plato que más le gustan)|null, ' +
        '"portions_per_meal": string (para cuántas raciones cocina cada comida, puede variar entre semana y finde)|null, ' +
        '"meals_to_plan": string (qué comidas quiere que se le planifiquen y se le incluyan en la compra: desayuno, comida, cena, snacks)|null, ' +
        '"kitchen_equipment": string (utensilios de cocina con los que cuenta: horno, air fryer, olla lenta...)|null, ' +
        '"cooking_skill": "básico"|"cómodo"|"avanzado"|null, ' +
        '"strength_training_experience": "ninguna"|"menos de 1 año"|"1-3 años"|"más de 3 años"|null, ' +
        '"supplements": string (suplementos habituales: proteína, creatina, vitaminas...)|null, ' +
        '"smoking": "no"|"ocasional"|"sí"|null, ' +
        '"tracking_experience": string (experiencia previa contando calorías o macros, o con dietas anteriores)|null, ' +
        '"weigh_in_cadence": "semanal"|"quincenal"|"cuando quiera"|null}. Sin markdown.',
    });

    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(json) as Record<string, unknown>;
    } catch {
      throw new Error("No hemos podido interpretar tus respuestas. Inténtalo de nuevo.");
    }
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
      pregnancy_status: str(p.pregnancy_status),
      menstrual_cycle: str(p.menstrual_cycle),
      ed_history: str(p.ed_history),
      alcohol: str(p.alcohol),
      allergy_severity: str(p.allergy_severity),
      disliked_foods: str(p.disliked_foods),
      cuisine_preference: str(p.cuisine_preference),
      portions_per_meal: str(p.portions_per_meal),
      meals_to_plan: str(p.meals_to_plan),
      kitchen_equipment: str(p.kitchen_equipment),
      cooking_skill: str(p.cooking_skill),
      strength_training_experience: str(p.strength_training_experience),
      supplements: str(p.supplements),
      smoking: str(p.smoking),
      tracking_experience: str(p.tracking_experience),
      weigh_in_cadence: str(p.weigh_in_cadence),
    };
  });
