import { dobFromAge } from "./age";
import type { Profile } from "./daily";

/**
 * Copia del `randomDemoProfile` de la web (`src/lib/demo-profile.ts`). El botón
 * "Probar con un perfil aleatorio" tiene que dejar la app igual en los dos
 * sitios: sesión anónima + un perfil coherente con el onboarding ya completado,
 * para entrar directo al dashboard sin responder las preguntas.
 */
const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;
const between = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

export function randomDemoProfile(): Partial<Profile> {
  const sex = pick(["hombre", "mujer"]);
  const height = sex === "hombre" ? between(168, 188) : between(155, 175);
  const weight = sex === "hombre" ? between(70, 95) : between(55, 80);
  const goal = pick(["perder", "mantener", "habitos", "energia"]);
  const age = between(24, 48);

  return {
    display_name: pick(["Alex", "Marta", "Javi", "Lucía", "Nacho", "Sara"]),
    age,
    date_of_birth: dobFromAge(age),
    sex,
    height_cm: height,
    current_weight_kg: weight,
    start_weight_kg: weight,
    // Sin datos de salud (ticket 30): un perfil nuevo no los guarda sin
    // consentimiento, y la guarda de la base de datos lo rechazaría. Quien prueba
    // la app puede activarlos en Ajustes › Privacidad.
    medical_conditions: null,
    medications: null,
    activity_level: pick(["ligero", "activo", "muy activo"]),
    exercise: pick([
      "Gimnasio 3 días por semana",
      "Correr 4 km tres veces por semana",
      "Paseo diario de 40 minutos y pádel los sábados",
    ]),
    meals_per_day: pick([3, 4]),
    diet_pattern: pick(["omnívoro", "omnívoro con poca carne roja", "vegetariano"]),
    non_negotiable_foods: pick([
      "El café de la mañana",
      "Chocolate negro por la noche",
      "El pan con el desayuno",
    ]),
    food_relationship: null,
    goal_type: goal,
    goal_amount: goal === "perder" ? between(3, 8) : null,
    goal_target_date: null,
    past_struggles: null,
    restrictions: pick([null, "Intolerancia leve a la lactosa"]),
    meal_schedule:
      "Desayuna en casa, come de tupper en el trabajo de lunes a viernes, cena en casa salvo un día que pide fuera y los fines de semana cocina en casa.",
    life_context:
      "Trabaja jornada completa y llega con poco tiempo para cocinar entre semana, así que cocina en tandas el domingo. Duerme unas 7 horas y el estrés le sube a media semana. Hace algo de deporte y quiere sentirse con más energía sin dietas estrictas.",
    budget_month_eur: between(180, 320),
    coach_scope: "comida y hábitos",
    tone: pick(["relajado", "neutro"]),
    morning_time: "08:00",
    evening_time: "22:00",
    locale: "es",
    timezone: "Europe/Madrid",
    country: "ES",
    currency: "EUR",
    pregnancy_status: null,
    menstrual_cycle: null,
    ed_history: null,
    alcohol: null,
    allergy_severity: null,
    disliked_foods: pick(["El cilantro y el hígado", "El pescado azul", null]),
    cuisine_preference: pick([
      "Mediterránea, casera de siempre",
      "Asiática y mediterránea",
      "Un poco de todo",
    ]),
    portions_per_meal: pick(["2 raciones entre semana, 4 el finde", "2 raciones siempre"]),
    meals_to_plan: pick(["Comida y cena", "Desayuno, comida y cena"]),
    kitchen_equipment: pick(["Horno y air fryer", "Horno, olla lenta y microondas"]),
    cooking_skill: pick(["básico", "cómodo", "avanzado"]),
    strength_training_experience: goal === "ganar" ? pick(["menos de 1 año", "1-3 años"]) : null,
    supplements: null,
    smoking: null,
    onboarding_completed: true,
    // Alta ~40 días atrás para que el navegador de meses de Plan tenga historial
    // que enseñar (y un mes anterior navegable) en las demos.
    app_started_on: new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10),
  };
}
