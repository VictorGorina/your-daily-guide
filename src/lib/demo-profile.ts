import { dobFromAge } from "@/lib/age";
import type { Profile } from "@/lib/daily";

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;
const between = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

/** Perfil aleatorio coherente para entrar directo al dashboard sin responder el onboarding. */
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
    medical_conditions: null,
    medications: null,
    activity_level: pick(["ligero", "activo", "muy activo"]),
    exercise: pick([
      "Gimnasio 3 días por semana",
      "Correr 4 km tres veces por semana",
      "Paseo diario de 40 minutos y pádel los sábados",
    ]),
    work_schedule: pick([
      "Oficina de 9 a 18",
      "Turnos rotativos",
      "Teletrabajo con horario flexible",
    ]),
    wake_time: pick(["06:45", "07:00", "07:30"]),
    sleep_time: pick(["23:00", "23:30", "00:00"]),
    meals_per_day: pick([3, 4]),
    diet_pattern: pick(["omnívoro", "omnívoro con poca carne roja", "vegetariano"]),
    non_negotiable_foods: pick([
      "El café de la mañana",
      "Chocolate negro por la noche",
      "El pan con el desayuno",
    ]),
    food_relationship: "Come bien de lunes a jueves y se relaja el fin de semana.",
    goal_type: goal,
    goal_amount: goal === "perder" ? between(3, 8) : null,
    goal_target_date: null,
    short_term_goal: pick([
      "Cenar en casa cuatro noches por semana",
      "Beber 2 litros de agua al día",
      "Comer verdura en dos comidas al día",
    ]),
    past_struggles: "Ha empezado dietas muy estrictas y las ha dejado a las dos semanas.",
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
    onboarding_completed: true,
  };
}
