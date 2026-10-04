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
      {
        key: "daily_activity",
        label: "Tu día a día (sin contar el deporte)",
        kind: "chips",
        options: [
          "Sentado (oficina, estudiar)",
          "De pie (tienda, docencia, casa con niños)",
          "Físico (hostelería, reparto)",
          "Muy físico (obra, campo, almacén)",
        ],
        valueMap: {
          "Sentado (oficina, estudiar)": "sentado",
          "De pie (tienda, docencia, casa con niños)": "de_pie",
          "Físico (hostelería, reparto)": "fisico",
          "Muy físico (obra, campo, almacén)": "muy_fisico",
        },
        help: "Con esto y tu rutina calculo tu gasto de energía de cada día.",
      },
      {
        key: "training",
        label: "Tu rutina de entrenamiento",
        kind: "text",
        help: "sesiones por semana × minutos · actividad · intensidad. Ej.: 3 × 45 min · gimnasio · normal (o «ninguna»)",
      },
      { key: "exercise", label: "Ejercicio que haces", kind: "long" },
      {
        key: "strength_training_experience",
        label: "Experiencia entrenando fuerza",
        kind: "chips",
        options: ["ninguna", "menos de 1 año", "1-3 años", "más de 3 años"],
      },
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
        help: "desayuno, comida, cena, merienda",
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
        key: "target_weight_kg",
        label: "Peso objetivo",
        kind: "number",
        min: 30,
        max: 300,
        unit: "kg",
        help: "El peso al que quieres llegar y mantenerte. La dirección (perder o ganar) se calcula sola.",
      },
      { key: "goal_target_date", label: "Fecha orientativa", kind: "date" },
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
      {
        key: "nutrition_numbers",
        label: "Ver calorías y macros",
        kind: "chips",
        options: ["Sí, enséñamelas", "No, prefiero no verlas"],
        valueMap: { "Sí, enséñamelas": "mostrar", "No, prefiero no verlas": "ocultar" },
        help:
          "Puedes cambiarlo cuando quieras. Si eliges «No», la app no te enseña calorías, " +
          "macros ni objetivos en ninguna pantalla, ni el coach te habla de cifras. Tus platos " +
          "se siguen calculando igual y las recetas mantienen sus cantidades.",
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

/**
 * Lo que el coach puede escribir en el perfil con `actualizar_perfil`,
 * validado campo a campo contra el catálogo: cada tipo con su formato y sus
 * límites, y un chip solo con una de sus opciones (con `valueMap`, el modelo
 * puede mandar la etiqueta o el valor guardado). Lo que no vale va a `invalid`,
 * con el valor recibido y lo que se esperaba, para decírselo al modelo: sin
 * eso, contestaba que lo había guardado.
 */
export function profilePatchFromTool(input: Record<string, unknown>): {
  patch: Partial<Profile>;
  invalid: string[];
} {
  const patch: Record<string, unknown> = {};
  const invalid: string[] = [];
  const reject = (field: ProfileField, raw: unknown, expected: string) =>
    invalid.push(`${field.label} («${String(raw).slice(0, 60)}»; ${expected})`);
  for (const field of CHAT_EDITABLE_PROFILE_FIELDS) {
    const raw = input[field.key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (field.kind === "number") {
      const n = Number(raw);
      const inRange =
        Number.isFinite(n) &&
        (field.min === undefined || n >= field.min) &&
        (field.max === undefined || n <= field.max);
      if (!inRange) {
        reject(
          field,
          raw,
          `entre ${field.min} y ${field.max}${field.unit ? ` ${field.unit}` : ""}`,
        );
        continue;
      }
      patch[field.key] = n;
    } else if (field.kind === "time") {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw))) {
        reject(field, raw, "hora HH:MM");
        continue;
      }
      patch[field.key] = raw;
    } else if (field.kind === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        reject(field, raw, "fecha AAAA-MM-DD");
        continue;
      }
      patch[field.key] = raw;
    } else if (field.kind === "chips" && field.valueMap) {
      const value = chipToValue(field, String(raw).trim());
      if (!Object.values(field.valueMap).includes(value)) {
        reject(field, raw, `valores válidos: ${Object.values(field.valueMap).join(", ")}`);
        continue;
      }
      patch[field.key] = value;
    } else if (field.kind === "chips" && field.options?.length) {
      // Solo una de sus opciones: el prompt y el cálculo de energía comparan
      // con el valor exacto («embarazada», «activa»), y un texto libre dejaría
      // el perfil diciendo una cosa y las reglas aplicando otra.
      const text = String(raw).trim().toLowerCase();
      const option = field.options.find((o) => o.toLowerCase() === text);
      if (!option) {
        reject(field, raw, `valores válidos: ${field.options.join(", ")}`);
        continue;
      }
      patch[field.key] = option;
    } else {
      patch[field.key] = String(raw).trim();
    }
  }
  return { patch: patch as Partial<Profile>, invalid };
}

/**
 * Campos que el coach no guarda sin que la persona lo confirme (ticket 31):
 * cambian el plan, el tono o la seguridad de forma importante, y un
 * malentendido del modelo (o un texto inyectado) podría marcar un embarazo,
 * una medicación o un historial de TCA que no existen.
 */
export const SENSITIVE_PROFILE_FIELDS = new Set<keyof Profile>([
  "pregnancy_status",
  "ed_history",
  "medications",
  "medical_conditions",
  "restrictions",
  "allergy_severity",
  "nutrition_numbers",
  "diet_pattern",
  "target_weight_kg",
]);

export function splitProfilePatch(patch: Partial<Profile>): {
  sensitive: Partial<Profile>;
  normal: Partial<Profile>;
} {
  const sensitive: Record<string, unknown> = {};
  const normal: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SENSITIVE_PROFILE_FIELDS.has(key as keyof Profile)) sensitive[key] = value;
    else normal[key] = value;
  }
  return { sensitive: sensitive as Partial<Profile>, normal: normal as Partial<Profile> };
}

export type SensitiveChange = { key: string; label: string; before: string; after: string };

function shownValue(field: ProfileField | undefined, value: unknown): string {
  if (value === undefined || value === null || value === "") return "sin dato";
  if (field?.kind === "chips") return valueToChip(field, String(value));
  if (field?.unit) return `${value} ${field.unit}`;
  return String(value);
}

/** Cada cambio sensible como lo lee la persona: etiqueta, antes → después. */
export function sensitiveChanges(
  sensitive: Partial<Profile>,
  current: Partial<Profile> | null | undefined,
): SensitiveChange[] {
  return Object.entries(sensitive).map(([key, value]) => {
    const field = PROFILE_FIELDS.find((f) => f.key === key);
    return {
      key,
      label: PROFILE_FIELD_LABELS[key] ?? key,
      before: shownValue(field, current?.[key as keyof Profile]),
      after: shownValue(field, value),
    };
  });
}

/**
 * Lo que vuelve al modelo tras `actualizar_perfil`: lo guardado, lo que la
 * persona eligió no guardar (que no insista: sin decírselo, volvía a
 * proponerlo) y lo que no se guardó por no ser válido (que no diga que está
 * guardado: en una prueba real lo afirmó).
 */
export function profileToolResult(saved: string[], declined: string[], invalid: string[]): string {
  const parts: string[] = [];
  if (saved.length) parts.push(`Perfil actualizado: ${saved.join(", ")}.`);
  if (declined.length) {
    parts.push(
      `La persona ha elegido no guardar esto en su perfil: ${declined.join(", ")}. ` +
        "Es su decisión, no un error: queda como estaba. No insistas ni vuelvas a proponerlo " +
        "salvo que te lo vuelva a pedir.",
    );
  }
  if (invalid.length) {
    parts.push(
      `No se ha guardado porque el valor no es válido: ${invalid.join("; ")}. ` +
        "Vuelve a llamar a la herramienta con uno de los valores válidos si lo que te ha dicho " +
        "encaja claramente en uno; si no, pregúntale. No digas que está guardado.",
    );
  }
  return parts.length
    ? parts.join(" ")
    : "No había ningún dato válido que actualizar en el perfil.";
}

/**
 * Texto de la confirmación, igual en la web (AlertDialog) y en el móvil
 * (Alert nativo). Ver cifras es una preferencia explícita que también vive en
 * Ajustes, y se recuerda.
 */
export function sensitiveConfirmCopy(changes: SensitiveChange[]): {
  title: string;
  lines: string[];
  note: string | null;
  confirm: string;
  cancel: string;
} {
  return {
    title:
      changes.length === 1
        ? "¿Guardo este cambio en tu perfil?"
        : "¿Guardo estos cambios en tu perfil?",
    lines: changes.map((c) => `${c.label}: ${c.before} → ${c.after}`),
    note: changes.some((c) => c.key === "nutrition_numbers")
      ? "Lo de ver calorías y macros también lo puedes cambiar cuando quieras en Ajustes."
      : null,
    confirm: "Guardar",
    cancel: "No, déjalo como estaba",
  };
}
