/**
 * Tipo del borrador de perfil que devuelve `/api/v1/onboarding/parse` (copia de
 * `OnboardingDraft` en `src/lib/onboarding.functions.ts`). La IA lee la
 * transcripción del cuestionario y devuelve estos campos; la pantalla los repasa
 * con el usuario antes de guardarlos con `saveProfile`.
 */
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
