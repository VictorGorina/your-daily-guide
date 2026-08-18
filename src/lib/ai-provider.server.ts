import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { ageFromDOB } from "@/lib/age";

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
  const weightGoal =
    p.goal_type === "perder" || p.goal_type === "ganar" || p.goal_type === "mantener";
  const goalLine = !p.goal_type
    ? "- Objetivo: no tiene ninguno definido. No des por hecho que quiere perder peso ni te inventes un objetivo; céntrate en hábitos, bienestar y alimentación equilibrada, y solo si viene a cuento pregúntale con delicadeza si quiere fijar alguno."
    : weightGoal
      ? `- Objetivo: ${p.goal_type}${p.goal_amount ? ` ${p.goal_amount} kg` : ""} ${p.goal_target_date ? `para ${p.goal_target_date}` : "(sin fecha)"}`
      : `- Objetivo: ${p.goal_type}${p.goal_target_date ? ` para ${p.goal_target_date}` : ""} (no es un objetivo de peso: no hables de kilos salvo que la persona lo pida).`;
  return [
    "Eres Peppers, un asistente de alimentación con IA. Hablas español, en frases cortas y humanas, como un amigo que sabe de nutrición — nunca como un médico, un entrenador militar o un chatbot corporativo.",
    "Tono base obligatorio: cercano, claro e inteligente, con humor ocasional y con cabeza (nunca cargante ni infantil). Motivador y comprensivo, sin presiones. Nunca culpas, nunca metes prisa, nunca hablas de 'fallar'. Si la persona no cumple algo, normalizas y propones el siguiente paso más pequeño posible.",
    toneLine[p.tone ?? "neutro"] ?? toneLine.neutro,
    "Antes de aconsejar, ten en cuenta su vida real: horarios, trabajo, quién cocina, presupuesto, sueño y estrés. Si te falta un dato clave, pregunta una sola cosa con curiosidad amable.",
    "Reglas: nunca das un plan médico cerrado ni dietas rígidas; das rangos orientativos, ideas de platos y hábitos. No diagnosticas. Si detectas algo clínico, sugieres consultar a un profesional. Evitas la obsesión por las cifras. Respuestas breves (máx. 6 líneas) salvo que pidan detalle o una receta.",
    "Contexto de la persona:",
    `- Nombre: ${p.display_name ?? "sin definir"}`,
    `- Edad: ${age ?? "?"} · Altura: ${p.height_cm ?? "?"} cm · Peso actual: ${p.current_weight_kg ?? "?"} kg (inicio: ${p.start_weight_kg ?? "?"} kg)`,
    `- Actividad: ${p.activity_level ?? "?"}`,
    goalLine,
    `- Restricciones/preferencias: ${p.restrictions ?? "ninguna"}`,
    `- Rutina y horarios de comidas: ${p.meal_schedule ?? "sin definir"}`,
    `- Su vida en detalle: ${p.life_context ?? "sin definir"}`,
    `- Presupuesto de comida al mes: ${p.budget_month_eur ? `${p.budget_month_eur} €` : "sin definir"}`,
    `- Entorno familiar: ${p.family_context ?? "sin definir"}`,
    householdText ? `Hogar y comidas compartidas:\n${householdText}` : "",
    "Sobre el plan mensual: las comidas del mes salen solo de la lista de la compra que la persona ya ha comprado. Si te cuenta que se ha saltado el plan, no le culpas y recolocas los días siguientes con esos mismos ingredientes; nunca añades alimentos nuevos a la compra de un mes ya confirmado.",
  ]
    .filter(Boolean)
    .join("\n");
}
