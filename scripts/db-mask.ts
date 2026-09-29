/**
 * Máscara de datos sensibles para `scripts/db.ts` (ticket 19 de la auditoría,
 * OPS-04). El inspector usa la clave de servicio y se salta RLS: sin máscara,
 * `bun run db profiles` volcaba medicación, historial de TCA o embarazo de
 * personas reales en la terminal, y de ahí a las transcripciones de las
 * sesiones de agentes.
 *
 * Se enmascara al imprimir, no en la consulta: así cubre también `--select *`
 * y los recursos embebidos de PostgREST (`household_members(display_name)`),
 * que llegan como un objeto anidado bajo el nombre de su tabla.
 *
 * Puro, sin Supabase: lo prueba `src/test/db-mask.test.ts`.
 */

/**
 * Columnas que no se imprimen sin `--unmask`: salud, texto libre de la persona,
 * nombres y el código de invitación al hogar (con él se entra en uno ajeno).
 * Nombres comprobados contra la base de datos real (los tipos generados van por
 * detrás). Sexo, edad y pesos se dejan visibles a propósito: son las entradas de
 * `energyTargets` y lo que más se mira al verificar cifras.
 */
export const SENSITIVE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  profiles: [
    "medications",
    "medical_conditions",
    "ed_history",
    "pregnancy_status",
    "menstrual_cycle",
    "food_relationship",
    "past_struggles",
    "life_context",
    "family_context",
    "restrictions",
    "allergy_severity",
    "supplements",
    "alcohol",
    "smoking",
    "display_name",
    "date_of_birth",
    "short_term_goal",
  ],
  chat_messages: ["content"],
  daily_logs: ["notes", "mood"],
  month_constraints: ["notes"],
  households: ["name", "goal_text", "invite_code"],
  household_members: ["display_name"],
  household_children: ["name", "notes", "allergies"],
};

export const HIDDEN = "[oculto]";

/**
 * - `omit`: sin `--select`, las columnas sensibles ni aparecen.
 * - `hide`: con `--select`, la columna pedida sale como `[oculto]`, para que se
 *   vea que existe y que se ha tapado.
 * - `show`: `--unmask`, tal cual.
 */
export type MaskMode = "omit" | "hide" | "show";

export function maskRows(table: string, data: unknown, mode: MaskMode): unknown {
  if (mode === "show") return data;
  return maskValue(table, data, mode);
}

function maskValue(table: string, value: unknown, mode: MaskMode): unknown {
  if (Array.isArray(value)) return value.map((item) => maskValue(table, item, mode));
  if (value === null || typeof value !== "object") return value;

  const sensitive = new Set(SENSITIVE_COLUMNS[table] ?? []);
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (sensitive.has(key)) {
      if (mode === "hide") out[key] = HIDDEN;
      continue;
    }
    // Un objeto anidado bajo el nombre de una tabla es un recurso embebido:
    // se enmascara con la lista de ESA tabla. Cualquier otro (un jsonb como
    // `plan` o `habits`) se recorre con la de la tabla actual.
    const innerTable = key in SENSITIVE_COLUMNS ? key : table;
    out[key] = maskValue(innerTable, inner, mode);
  }
  return out;
}

/** Columnas sensibles de `table` que aparecen en un `--select` explícito. */
export function sensitiveInSelect(table: string, select: string): string[] {
  const sensitive = new Set(SENSITIVE_COLUMNS[table] ?? []);
  if (select.trim() === "*") return [...sensitive];
  return select
    .split(",")
    .map((col) => col.trim().split(":").pop()!.trim())
    .filter((col) => sensitive.has(col));
}
