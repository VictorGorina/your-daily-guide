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
};
