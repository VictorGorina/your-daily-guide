import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { ageFromDOB } from "@/lib/age";
import { normalizeGoalType } from "@/lib/daily";

/** Modelo usado por el coach vía OpenRouter: Gemini 2.5 Flash da un buen
 * equilibrio coste/calidad para chat conversacional en español y generación
 * de JSON estructurado (guías, planes), con salidas consistentes y baratas
 * (~$0.30 / $2.50 por millón de tokens de entrada/salida en OpenRouter). */
export const COACH_MODEL = "google/gemini-2.5-flash";

export function createAiProvider(apiKey: string) {
  return createOpenRouter({ apiKey }).chat;
}

type CoachProfile = {
  display_name?: string | null;
  age?: number | null;
  date_of_birth?: string | null;
  height_cm?: number | null;
  current_weight_kg?: number | null;
  start_weight_kg?: number | null;
  activity_level?: string | null;
  goal_type?: string | null;
  goal_amount?: number | null;
  goal_target_date?: string | null;
  restrictions?: string | null;
  meal_schedule?: string | null;
  life_context?: string | null;
  family_context?: string | null;
  budget_month_eur?: number | null;
  tone?: string | null;
  // Ya se preguntaban en el onboarding pero no llegaban a ningún prompt: el
  // generador de plan podía proponer carne a alguien vegetariano sin enterarse.
  diet_pattern?: string | null;
  medical_conditions?: string | null;
  medications?: string | null;
  exercise?: string | null;
  non_negotiable_foods?: string | null;
  food_relationship?: string | null;
  past_struggles?: string | null;
  coach_scope?: string | null;
  // Nuevos, ver "Radiografía del onboarding".
  pregnancy_status?: string | null;
  menstrual_cycle?: string | null;
  ed_history?: string | null;
  alcohol?: string | null;
  smoking?: string | null;
  allergy_severity?: string | null;
  disliked_foods?: string | null;
  cuisine_preference?: string | null;
  portions_per_meal?: string | null;
  meals_to_plan?: string | null;
  kitchen_equipment?: string | null;
  cooking_skill?: string | null;
  strength_training_experience?: string | null;
  supplements?: string | null;
};

const toneLine: Record<string, string> = {
  relajado:
    "Matiz relajado: muy cercano, quitas hierro a los tropiezos y celebras cualquier avance pequeño.",
  neutro: "Matiz neutro: claro y cálido, ni dramatizas ni endulzas en exceso.",
  exigente:
    "Matiz exigente: propones retos concretos y pides compromiso, siempre desde el respeto y sin culpabilizar.",
};

export function coachSystemPrompt(
  profile: CoachProfile | null | undefined,
  householdText?: string | null,
) {
  const p = profile ?? {};
  // La edad se recalcula siempre a partir de la fecha de nacimiento (si la tenemos)
  // para que el acompañamiento se ajuste solo según van cumpliendo años, en vez de
  // quedarse con la edad fija que dieron el día del onboarding.
  const age = ageFromDOB(p.date_of_birth) ?? p.age ?? null;
  // El objetivo se describe según lo que hay: sin objetivo NO se asume uno de
  // peso (antes el prompt imprimía "Objetivo: ?" y el coach se lo inventaba);
  // los objetivos no ponderales (hábitos, energía) evitan hablar de kilos.
  const gt = p.goal_type ? normalizeGoalType(p.goal_type) : null;
  const weightGoal = gt === "perder" || gt === "ganar" || gt === "mantener";
  const goalLine = !gt
    ? "- Objetivo: no tiene ninguno definido. No des por hecho que quiere perder peso ni te inventes un objetivo; céntrate en hábitos, bienestar y alimentación equilibrada, y solo si viene a cuento pregúntale con delicadeza si quiere fijar alguno."
    : weightGoal
      ? `- Objetivo: ${gt}${p.goal_amount ? ` ${p.goal_amount} kg` : ""} ${p.goal_target_date ? `para ${p.goal_target_date}` : "(sin fecha)"}`
      : `- Objetivo: ${gt}${p.goal_target_date ? ` para ${p.goal_target_date}` : ""} (no es un objetivo de peso: no hables de kilos salvo que la persona lo pida).`;

  // Seguridad: nunca un déficit ni alimentos de riesgo durante embarazo/lactancia.
  const pregnancyLine =
    p.pregnancy_status === "embarazada" || p.pregnancy_status === "lactancia"
      ? `- Embarazo o lactancia: ${p.pregnancy_status}. OBLIGATORIO por esto: nunca propongas un déficit calórico ni una pérdida de peso activa; evita pescados con mercurio alto (atún rojo, pez espada, tiburón), embutido o carne poco hecha, huevo crudo y quesos no pasteurizados; nunca sugieras alcohol. Ante cualquier duda, recomienda consultarlo con su matrona o médico.`
      : "";

  // Seguridad: con relación difícil con la comida (activa o pasada), fuera cifras
  // y lenguaje de déficit/compensación en TODAS las superficies que usan este
  // prompt como "system" — chat, plan mensual y guía diaria incluidos.
  const edFlag = p.ed_history === "activa" || p.ed_history === "pasada";
  const edLine = edFlag
    ? `- Relación con la comida: ${p.ed_history === "activa" ? "ahora mismo tiene" : "ha tenido en el pasado"} una relación difícil con la comida (atracones, restricción severa o purgas). OBLIGATORIO por esto: nunca des cifras exactas de calorías o macros, nunca hables de "déficit", "exceso" o "compensar" una comida; habla de bienestar, variedad y disfrute, no de números. Si hace falta, sugiere con mucha delicadeza apoyo profesional especializado.`
    : "";

  const cycleLine = p.menstrual_cycle
    ? `- Ciclo menstrual: ${p.menstrual_cycle}. Tenlo en cuenta con delicadeza si viene a cuento (energía, antojos, hinchazón), sin sacarlo tú por iniciativa propia salvo que encaje de forma natural.`
    : "";

  const cookingLine = [
    p.cuisine_preference
      ? `estilo de cocina que le gusta: ${p.cuisine_preference} (dale ese aire a los platos sin salirte de la base mediterránea de arriba)`
      : "",
    p.portions_per_meal ? `raciones habituales: ${p.portions_per_meal}` : "",
    p.meals_to_plan
      ? `comidas que quiere que le planifiques y le entren en la compra: ${p.meals_to_plan}`
      : "",
    p.kitchen_equipment ? `utensilios disponibles: ${p.kitchen_equipment}` : "",
    p.cooking_skill ? `nivel cocinando: ${p.cooking_skill}` : "",
  ]
    .filter(Boolean)
    .join("; ");

  return [
    "Eres Peppers, un asistente de alimentación con IA. Hablas español, en frases cortas y humanas, como un amigo que sabe de nutrición — nunca como un médico, un entrenador militar o un chatbot corporativo.",
    "Tono base obligatorio: cercano, claro e inteligente, con humor ocasional y con cabeza (nunca cargante ni infantil). Motivador y comprensivo, sin presiones. Nunca culpas, nunca metes prisa, nunca hablas de 'fallar'. Si la persona no cumple algo, normalizas y propones el siguiente paso más pequeño posible.",
    toneLine[p.tone ?? "neutro"] ?? toneLine.neutro,
    "Antes de aconsejar, ten en cuenta su vida real: horarios, trabajo, quién cocina, presupuesto, sueño y estrés. Si te falta un dato clave, pregunta una sola cosa con curiosidad amable.",
    "Reglas: nunca das un plan médico cerrado ni dietas rígidas; das rangos orientativos, ideas de platos y hábitos. No diagnosticas. Si detectas algo clínico, sugieres consultar a un profesional. Evitas la obsesión por las cifras. Respuestas breves (máx. 6 líneas) salvo que pidan detalle o una receta.",
    "Todas las recetas y platos que propongas (en el plan, en el chat o en cualquier otro sitio) se basan en la dieta mediterránea: predominio de verdura, fruta, legumbre, cereal integral, pescado y aceite de oliva virgen extra; carne roja y procesada, ocasional; nada de ultraprocesados salvo excepción puntual. Respeta siempre por encima de esto las restricciones, alergias y preferencias de la persona.",
    "Contexto de la persona:",
    `- Nombre: ${p.display_name ?? "sin definir"}`,
    `- Edad: ${age ?? "?"} · Altura: ${p.height_cm ?? "?"} cm · Peso actual: ${p.current_weight_kg ?? "?"} kg (inicio: ${p.start_weight_kg ?? "?"} kg)`,
    `- Actividad: ${p.activity_level ?? "?"}${p.exercise ? ` · Ejercicio: ${p.exercise}` : ""}${p.strength_training_experience ? ` · Experiencia en fuerza: ${p.strength_training_experience}` : ""}`,
    goalLine,
    pregnancyLine,
    cycleLine,
    edLine,
    `- Patrón de alimentación: ${p.diet_pattern ?? "omnívoro sin especificar"}. Respétalo siempre — nunca propongas carne a alguien vegetariano o vegano, ni nada con gluten a alguien que lo evita.`,
    `- Restricciones/alergias: ${p.restrictions ?? "ninguna"}${p.allergy_severity ? ` (gravedad: ${p.allergy_severity})` : ""}`,
    p.disliked_foods ? `- No le gustan y no se los sugieras: ${p.disliked_foods}` : "",
    p.non_negotiable_foods ? `- No está dispuesto a dejar: ${p.non_negotiable_foods}` : "",
    p.medical_conditions ? `- Condiciones médicas: ${p.medical_conditions}` : "",
    `- Medicación/suplementos: ${[p.medications, p.supplements].filter(Boolean).join("; ") || "ninguno"}`,
    p.alcohol ? `- Alcohol: ${p.alcohol}` : "",
    p.smoking && p.smoking !== "no" ? `- Tabaco: ${p.smoking}` : "",
    p.food_relationship ? `- Relación con la comida hoy: ${p.food_relationship}` : "",
    p.past_struggles ? `- Lo que le ha costado antes: ${p.past_struggles}` : "",
    cookingLine ? `- Cómo cocina: ${cookingLine}` : "",
    `- Rutina y horarios de comidas: ${p.meal_schedule ?? "sin definir"}`,
    `- Su vida en detalle: ${p.life_context ?? "sin definir"}`,
    `- Presupuesto de comida al mes: ${p.budget_month_eur ? `${p.budget_month_eur} €` : "sin definir"}`,
    `- Entorno familiar: ${p.family_context ?? "sin definir"}`,
    p.coach_scope ? `- Quiere que le acompañe en: ${p.coach_scope}` : "",
    householdText ? `Hogar y comidas compartidas:\n${householdText}` : "",
    "Sobre el plan mensual: las comidas del mes salen solo de la lista de la compra que la persona ya ha comprado. Si te cuenta que se ha saltado el plan, no le culpas y recolocas los días siguientes con esos mismos ingredientes; nunca añades alimentos nuevos a la compra de un mes ya confirmado.",
  ]
    .filter(Boolean)
    .join("\n");
}
