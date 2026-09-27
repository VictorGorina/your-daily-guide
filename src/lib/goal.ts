/**
 * Objetivo de peso de la persona: su dirección (perder, ganar, mantener) y el
 * progreso hacia él. Puro (solo lógica, sin I/O): lo usan el cliente, el
 * servidor y los tests, así que no puede importar la capa de datos. Antes
 * vivía en `daily.ts`, que importa el cliente de Supabase del navegador, y
 * con él lo arrastraban `nutrition/energy.ts` y siete módulos de servidor
 * (ticket 26 de la auditoría, CAL-07).
 */

/** Los campos del perfil que miran las funciones de este archivo. */
export type GoalProfile = {
  target_weight_kg: number | null;
  current_weight_kg: number | null;
  start_weight_kg: number | null;
  goal_type: string | null;
  goal_amount: number | null;
};

/**
 * Normaliza goal_type para absorber las etiquetas UI que se guardaron en BD
 * por error (ver bug chips perfil — "perder peso" en vez de "perder").
 * Exportada porque el prompt del coach (ai-provider.server.ts) y
 * goalProgress necesitan la misma normalización.
 */
export function normalizeGoalType(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.startsWith("perder")) return "perder";
  if (lower.startsWith("ganar")) return "ganar";
  if (lower === "salud") return "habitos";
  return raw;
}

/**
 * Deduce la dirección del objetivo comparando peso actual vs peso objetivo.
 * ±thresholdKg alrededor del target cuenta como "mantener" (zona de estabilidad).
 */
export function deriveGoalType(
  currentKg: number | null | undefined,
  targetKg: number | null | undefined,
  thresholdKg = 1,
): "perder" | "ganar" | "mantener" | null {
  if (currentKg == null || targetKg == null) return null;
  const diff = currentKg - targetKg;
  if (diff > thresholdKg) return "perder";
  if (diff < -thresholdKg) return "ganar";
  return "mantener";
}

export type GoalDirection = "perder" | "ganar" | "mantener";

/**
 * Hacia dónde va el objetivo de la persona: el peso objetivo contra el actual
 * (o el de partida) si lo hay; si no, el `goal_type` legacy normalizado. Un
 * objetivo que no es de peso ("habitos", "energia") o ninguno → `null`.
 *
 * Lo usan la decisión de compensar (`compensationNeed`, que con `null` usa la
 * fila de mantener) y el objetivo energético. `nutrition/energy.ts` tiene su
 * propia copia (`goalOf`) porque el drift check la compara con la de
 * `mobile/lib/energy.ts`: se unifica cuando el móvil tenga su `goal.ts`.
 * Acepta una fila de `profiles` sin tipar, por eso los campos son `unknown`.
 */
export function goalDirection(p: {
  target_weight_kg?: unknown;
  current_weight_kg?: unknown;
  start_weight_kg?: unknown;
  goal_type?: unknown;
}): GoalDirection | null {
  if (p.target_weight_kg != null) {
    const current = p.current_weight_kg ?? p.start_weight_kg ?? p.target_weight_kg;
    return deriveGoalType(Number(current), Number(p.target_weight_kg));
  }
  const legacy = p.goal_type ? normalizeGoalType(String(p.goal_type)) : null;
  return legacy === "perder" || legacy === "ganar" || legacy === "mantener" ? legacy : null;
}

export type GoalProgress = {
  pct: number;
  /** Progreso con signo en la dirección del objetivo, en kg (negativo = va al revés). */
  done: number;
  /** Meta numérica en kg. 0 cuando la persona no dio un número. */
  total: number;
  unit: string;
  /** True when weight is moving opposite to the goal direction. */
  regressing: boolean;
  /** Hay datos para enseñar progreso (objetivo de peso + peso de partida). */
  measurable: boolean;
  /** Hay una meta numérica contra la que medir un porcentaje. */
  hasTarget: boolean;
  /** Peso objetivo, si existe. */
  targetKg: number | null;
  /** Distancia actual al objetivo en kg (siempre ≥ 0). */
  distanceKg: number;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const ZERO: GoalProgress = {
  pct: 0,
  done: 0,
  total: 0,
  unit: "kg",
  regressing: false,
  measurable: false,
  hasTarget: false,
  targetKg: null,
  distanceKg: 0,
};

export function goalProgress(profile: GoalProfile | null): GoalProgress {
  if (!profile) return ZERO;

  // ── Camino nuevo: target_weight_kg es la fuente canónica ──
  if (profile.target_weight_kg != null) {
    const target = Number(profile.target_weight_kg);
    const current = Number(profile.current_weight_kg ?? profile.start_weight_kg ?? target);
    const start = Number(profile.start_weight_kg ?? current);
    const distanceKg = Math.abs(current - target);

    // La dirección del PROGRESO se mide contra el camino original (start→target),
    // no contra la posición actual. Así, si alguien empezó en 100 queriendo 80 y
    // ahora está en 78 (sobrepasó), sigue viendo 100% de progreso en vez de un
    // cambio repentino a "ganar". `deriveGoalType` (current vs target) es para
    // los prompts de la IA — decide qué hacer AHORA, no el histórico.
    const totalPath = Math.abs(start - target);
    const originalDir: "perder" | "ganar" | "mantener" =
      start > target + 1 ? "perder" : start < target - 1 ? "ganar" : "mantener";

    if (originalDir === "mantener" || totalPath < 1) {
      // Start ≈ target: la persona quiere mantenerse donde ya está.
      return {
        pct: clamp01(1 - distanceKg / 3),
        done: distanceKg,
        total: 0,
        unit: "kg",
        regressing: distanceKg > 1,
        measurable: true,
        hasTarget: true,
        targetKg: target,
        distanceKg,
      };
    }

    // "perder" o "ganar": progreso = fracción del camino start→target recorrida.
    const done = originalDir === "perder" ? start - current : current - start;
    return {
      pct: totalPath > 0 ? clamp01(done / totalPath) : done >= 0 ? 1 : 0,
      done,
      total: totalPath,
      unit: "kg",
      regressing: done < 0,
      measurable: true,
      hasTarget: true,
      targetKg: target,
      distanceKg,
    };
  }

  // ── Fallback legacy: goal_type + goal_amount (usuarios pre-migración) ──
  if (!profile.goal_type) return ZERO;
  const goal = normalizeGoalType(profile.goal_type);
  const start = Number(profile.start_weight_kg ?? 0);
  const current = Number(profile.current_weight_kg ?? start);
  const total = Number(profile.goal_amount ?? 0);
  if (!profile.start_weight_kg) return ZERO;

  if (goal === "mantener") {
    const drift = Math.abs(current - start);
    return {
      pct: clamp01(1 - drift / 3),
      done: drift,
      total: 0,
      unit: "kg",
      regressing: drift > 1,
      measurable: true,
      hasTarget: false,
      targetKg: null,
      distanceKg: drift,
    };
  }

  if (goal === "perder" || goal === "ganar") {
    const done = goal === "perder" ? start - current : current - start;
    const hasTarget = total > 0;
    return {
      pct: hasTarget ? clamp01(done / total) : 0,
      done,
      total: hasTarget ? total : 0,
      unit: "kg",
      regressing: done < 0,
      measurable: true,
      hasTarget,
      targetKg: null,
      distanceKg: Math.abs(done),
    };
  }

  // "habitos" / "energia": no hay métrica de peso que enseñar.
  return ZERO;
}
