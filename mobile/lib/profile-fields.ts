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
  /**
   * Para chips cuya etiqueta UI difiere del valor almacenado en BD.
   * Clave = etiqueta que se muestra, valor = lo que se guarda.
   */
  valueMap?: Record<string, string>;
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
      {
        key: "supplements",
        label: "Suplementos",
        kind: "text",
        help: "proteína, creatina, vitaminas...",
      },
      {
        key: "smoking",
        label: "Tabaco",
        kind: "chips",
        options: ["no", "ocasional", "sí"],
      },
      {
        key: "pregnancy_status",
        label: "Embarazo o lactancia",
        kind: "chips",
        options: ["no", "embarazada", "lactancia", "prefiero no decirlo"],
      },
      {
        key: "menstrual_cycle",
        label: "Ciclo menstrual",
        kind: "long",
        help: "si te afecta al apetito, energía o antojos",
      },
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
      {
        key: "strength_training_experience",
        label: "Experiencia entrenando fuerza",
        kind: "chips",
        options: ["ninguna", "menos de 1 año", "1-3 años", "más de 3 años"],
      },
      { key: "work_schedule", label: "Horario de trabajo", kind: "long" },
      { key: "wake_time", label: "Hora de despertar", kind: "time" },
      { key: "sleep_time", label: "Hora de dormir", kind: "time" },
      { key: "life_context", label: "Cómo es tu vida ahora", kind: "long" },
      {
        key: "alcohol",
        label: "Alcohol",
        kind: "chips",
        options: ["nunca", "ocasional", "frecuente"],
      },
    ],
  },
  {
    title: "Cómo comes hoy",
    fields: [
      { key: "meals_per_day", label: "Comidas al día", kind: "number", min: 1, max: 8 },
      {
        key: "meals_to_plan",
        label: "Comidas que quieres que te planifique",
        kind: "text",
        help: "desayuno, comida, cena, snacks",
      },
      { key: "meal_schedule", label: "Dónde y cuándo comes", kind: "long" },
      { key: "diet_pattern", label: "Tipo de alimentación", kind: "text" },
      { key: "restrictions", label: "Alergias o restricciones", kind: "long" },
      {
        key: "allergy_severity",
        label: "Gravedad de tus alergias",
        kind: "text",
        help: "cuáles son graves y cuáles llevaderas",
      },
      { key: "non_negotiable_foods", label: "Comidas que no quieres dejar", kind: "long" },
      { key: "disliked_foods", label: "Ingredientes que no te gustan", kind: "long" },
      { key: "cuisine_preference", label: "Cocina que más te gusta", kind: "text" },
      {
        key: "portions_per_meal",
        label: "Raciones por comida",
        kind: "text",
        help: "puede variar entre semana y finde",
      },
      { key: "kitchen_equipment", label: "Utensilios de cocina", kind: "text" },
      {
        key: "cooking_skill",
        label: "Nivel cocinando",
        kind: "chips",
        options: ["básico", "cómodo", "avanzado"],
      },
      { key: "food_relationship", label: "Tu relación con la comida", kind: "long" },
      {
        key: "ed_history",
        label: "Relación difícil con la comida",
        kind: "chips",
        options: ["no", "activa", "pasada", "prefiero no decirlo"],
      },
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
        valueMap: {
          "perder peso": "perder",
          mantener: "mantener",
          "ganar músculo": "ganar",
          salud: "habitos",
        },
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
      { key: "tracking_experience", label: "Experiencia contando calorías", kind: "long" },
      {
        key: "weigh_in_cadence",
        label: "Cada cuánto pesarte",
        kind: "chips",
        options: ["semanal", "quincenal", "cuando quiera"],
      },
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

/** Etiqueta UI → valor almacenado (identity si no hay mapa). */
export function chipToValue(field: ProfileField, chip: string): string {
  return field.valueMap?.[chip] ?? chip;
}

/** Valor almacenado → etiqueta UI (identity si no hay mapa). */
export function valueToChip(field: ProfileField, stored: string): string {
  if (!field.valueMap) return stored;
  const entry = Object.entries(field.valueMap).find(([, v]) => v === stored);
  return entry ? entry[0] : stored;
}
