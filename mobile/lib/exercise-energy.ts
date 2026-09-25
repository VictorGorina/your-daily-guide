/**
 * Gasto NETO del deporte, dependiente del peso (ticket 07 de
 * `precision-nutricional`; lo reutiliza el 16 para "Registrar deporte").
 *
 * `(MET − 1) × kg × horas`: el MET mide el gasto de la actividad en múltiplos
 * del gasto en reposo (1 MET ≈ 1 kcal/kg/h), y se resta 1 porque ese reposo ya
 * está dentro del metabolismo basal. Sin restarlo, la hora de gimnasio se
 * contaría dos veces.
 *
 * Puro y sin dependencias: se puede usar en el cliente, en el servidor y en los
 * tests. Copia de `src/lib/nutrition/exercise-energy.ts` de la web.
 */

export type ExerciseIntensity = "Suave" | "Normal" | "Fuerte";

/**
 * MET por actividad (las mismas etiquetas que `EXERCISE_ACTIVITIES`) e
 * intensidad. Valores del Compendio de Actividades Físicas (Ainsworth et al.,
 * ediciones 2011 y 2024), redondeados. "Normal" es la entrada genérica de cada
 * actividad; "Suave" y "Fuerte", las de ritmo bajo y alto.
 */
export const EXERCISE_MET: Record<string, Record<ExerciseIntensity, number>> = {
  Correr: { Suave: 7, Normal: 9, Fuerte: 11 },
  Caminar: { Suave: 2.8, Normal: 3.5, Fuerte: 5 },
  Bici: { Suave: 5.8, Normal: 7.5, Fuerte: 10 },
  "Gimnasio / pesas": { Suave: 3.5, Normal: 5, Fuerte: 6 },
  Natación: { Suave: 6, Normal: 7, Fuerte: 9.8 },
  Otra: { Suave: 3.5, Normal: 5, Fuerte: 7 },
};

const intensityOf = (raw: string): ExerciseIntensity =>
  raw === "Suave" || raw === "Fuerte" ? raw : "Normal";

/** kcal netas (positivo) de una sesión. 0 sin peso o sin minutos. */
export function exerciseNetKcal(
  activity: string,
  minutes: number,
  intensity: string,
  weightKg: number,
): number {
  if (!(weightKg > 0) || !(minutes > 0)) return 0;
  const met = (EXERCISE_MET[activity] ?? EXERCISE_MET.Otra)[intensityOf(intensity)];
  return Math.round((met - 1) * weightKg * (minutes / 60));
}

/**
 * Rutina de entrenamiento habitual (D9): lo que la persona hace una semana
 * normal. Entra en el objetivo de cada día, así que "Registrar deporte" solo
 * compensa lo que pase de ella (ticket 16).
 */
export type TrainingRoutine = {
  sessionsPerWeek: number;
  minutes: number;
  activity: string;
  intensity: ExerciseIntensity;
};

const ACTIVITY_WORDS: [RegExp, string][] = [
  [/\b(corr|running|carrera|trote|footing)/, "Correr"],
  [/\b(camin|andar|paseo|pasear|senderis)/, "Caminar"],
  [/\b(bici|ciclis|spinning)/, "Bici"],
  [/\b(gimnasio|gym|pesas|fuerza|crossfit|musculaci)/, "Gimnasio / pesas"],
  [/\b(nata|nadar|piscina)/, "Natación"],
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(",", ".");

/**
 * Lee la rutina del texto corto que se guarda en `profiles.training` y que se
 * edita en Ajustes o por chat ("3 × 45 min · Gimnasio / pesas · Normal", pero
 * también "gym 4 días 1 hora" o "no entreno"). Tolerante a propósito: lo
 * escribe una persona o lo extrae el modelo.
 *
 * `null` = no se entiende (se trata como sin dato); `sessionsPerWeek: 0` = la
 * persona ha dicho que no entrena, que SÍ es un dato.
 */
export function parseTraining(raw: string | null | undefined): TrainingRoutine | null {
  const text = norm(String(raw ?? "")).trim();
  if (!text) return null;
  if (/^(ninguna?|nada|no|0|no entreno|sin rutina|no hago)\b/.test(text)) {
    return { sessionsPerWeek: 0, minutes: 0, activity: "Otra", intensity: "Normal" };
  }

  const sessionsMatch =
    text.match(/(\d+)\s*(?:×|x|veces|dias|sesiones|d\/sem|por semana|a la semana|al semana)/) ??
    text.match(/^(\d+)\b/);
  const sessions = sessionsMatch ? Number(sessionsMatch[1]) : NaN;
  if (!Number.isFinite(sessions) || sessions <= 0) return null;

  const minutesMatch = text.match(/(\d+)\s*(?:min|minutos|')/) ?? text.match(/\d+\s*[×x]\s*(\d+)/);
  const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hora|horas)\b/);
  const minutes = minutesMatch
    ? Number(minutesMatch[1])
    : hoursMatch
      ? Math.round(Number(hoursMatch[1]) * 60)
      : 60; // sin duración: la sesión típica de una hora

  const activity = ACTIVITY_WORDS.find(([re]) => re.test(text))?.[1] ?? "Otra";
  const intensity: ExerciseIntensity = /(suave|ligera|tranquil|facil)/.test(text)
    ? "Suave"
    : /(fuerte|intens|dura|alta)/.test(text)
      ? "Fuerte"
      : "Normal";

  return {
    sessionsPerWeek: Math.min(14, Math.round(sessions)),
    minutes: Math.min(360, Math.max(5, Math.round(minutes))),
    activity,
    intensity,
  };
}

/** Forma canónica del texto de la rutina, la que se guarda y se enseña. */
export function formatTraining(r: TrainingRoutine): string {
  if (!r.sessionsPerWeek) return "Ninguna";
  return `${r.sessionsPerWeek} × ${r.minutes} min · ${r.activity} · ${r.intensity}`;
}

/** kcal netas por día de la rutina, repartidas en la semana. */
export function routineDailyKcal(r: TrainingRoutine | null, weightKg: number): number {
  if (!r || !r.sessionsPerWeek) return 0;
  return Math.round(
    (r.sessionsPerWeek * exerciseNetKcal(r.activity, r.minutes, r.intensity, weightKg)) / 7,
  );
}
