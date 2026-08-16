import type { Profile } from "./daily";

/**
 * Catálogo único de los campos editables del perfil: de aquí sale tanto la
 * pantalla "Mis respuestas" (Ajustes) como la herramienta que usa el coach
 * para actualizar el perfil por chat. Un solo sitio para añadir un campo
 * nuevo y que aparezca editable en los dos canales.
 *
 * Copia de `src/lib/profile-fields.ts` de la web (aún no hay `packages/shared/`;
 * si allí cambia el catálogo, hay que reflejarlo aquí — dos copias a propósito,
 * ver AGENTS.md).
 */
export type FieldKind = "text" | "long" | "number" | "time" | "chips" | "date";

export type ProfileField = {
  key: keyof Profile;
  label: string;
  kind: FieldKind;
  help?: string;
  options?: string[];
  min?: number;
  max?: number;
  unit?: string;
};

export type ProfileSection = { title: string; fields: ProfileField[] };

export const PROFILE_SECTIONS: ProfileSection[] = [
  {
    title: "Sobre ti",
    fields: [
      { key: "display_name", label: "Nombre", kind: "text" },
      { key: "date_of_birth", label: "Fecha de nacimiento", kind: "date" },
      { key: "sex", label: "Sexo", kind: "chips", options: ["mujer", "hombre", "otro"] },
      { key: "height_cm", label: "Altura", kind: "number", min: 100, max: 250, unit: "cm" },
      {
        key: "current_weight_kg",
        label: "Peso actual",
        kind: "number",
        min: 25,
        max: 350,
        unit: "kg",
      },
      { key: "medical_conditions", label: "Condiciones médicas", kind: "long" },
      { key: "medications", label: "Medicación", kind: "long" },
    ],
  },
  {
    title: "Tu día a día",
    fields: [
      {
        key: "activity_level",
        label: "Nivel de actividad",
        kind: "chips",
        options: ["sedentario", "ligero", "moderado", "alto"],
      },
      { key: "exercise", label: "Ejercicio que haces", kind: "long" },
      { key: "work_schedule", label: "Horario de trabajo", kind: "long" },
      { key: "wake_time", label: "Hora de despertar", kind: "time" },
      { key: "sleep_time", label: "Hora de dormir", kind: "time" },
      { key: "life_context", label: "Cómo es tu vida ahora", kind: "long" },
    ],
  },
  {
    title: "Cómo comes hoy",
    fields: [
      { key: "meals_per_day", label: "Comidas al día", kind: "number", min: 1, max: 8 },
      { key: "meal_schedule", label: "Dónde y cuándo comes", kind: "long" },
      { key: "diet_pattern", label: "Tipo de alimentación", kind: "text" },
      { key: "restrictions", label: "Alergias o restricciones", kind: "long" },
      { key: "non_negotiable_foods", label: "Comidas que no quieres dejar", kind: "long" },
      { key: "food_relationship", label: "Tu relación con la comida", kind: "long" },
      {
        key: "budget_month_eur",
        label: "Presupuesto mensual",
        kind: "number",
        min: 20,
        max: 3000,
        unit: "€",
      },
    ],
  },
  {
    title: "Hacia dónde vamos",
    fields: [
      {
        key: "goal_type",
        label: "Objetivo",
        kind: "chips",
        options: ["perder peso", "mantener", "ganar músculo", "salud"],
      },
      {
        key: "goal_amount",
        label: "Cantidad objetivo",
        kind: "number",
        min: 0.5,
        max: 100,
        unit: "kg",
      },
      { key: "goal_target_date", label: "Fecha objetivo", kind: "date" },
      { key: "short_term_goal", label: "Objetivo a corto plazo", kind: "long" },
      { key: "past_struggles", label: "Qué te ha costado antes", kind: "long" },
    ],
  },
  {
    title: "Cómo te acompaño",
    fields: [
      {
        key: "tone",
        label: "Tono del coach",
        kind: "chips",
        options: ["relajado", "neutro", "exigente"],
      },
      {
        key: "coach_scope",
        label: "En qué te acompaño",
        kind: "chips",
        options: ["comida", "comida y hábitos"],
      },
      { key: "morning_time", label: "Resumen de la mañana", kind: "time" },
      { key: "evening_time", label: "Repaso de la noche", kind: "time" },
    ],
  },
];

export const PROFILE_FIELDS: ProfileField[] = PROFILE_SECTIONS.flatMap((s) => s.fields);

export const PROFILE_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  PROFILE_FIELDS.map((f) => [f.key, f.label]),
);

/**
 * Campos que ya tienen su propia herramienta de chat dedicada
 * (actualizar_peso, cambiar_fecha_objetivo): la herramienta genérica
 * actualizar_perfil no los incluye para no pisarse con ellas.
 */
export const CHAT_PROFILE_FIELD_EXCLUDE = new Set<keyof Profile>([
  "current_weight_kg",
  "goal_target_date",
]);

export const CHAT_EDITABLE_PROFILE_FIELDS: ProfileField[] = PROFILE_FIELDS.filter(
  (f) => !CHAT_PROFILE_FIELD_EXCLUDE.has(f.key),
);
