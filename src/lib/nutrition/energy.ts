/**
 * Objetivo de energía y macros de cada persona, calculado en código (ticket 07
 * de `precision-nutricional`, decisiones D2 y D9). Es LA ÚNICA cifra de
 * objetivo de la app: la barra de Hoy, el semáforo del calendario, el texto de
 * la guía y el coach salen de aquí. El modelo nunca escribe un objetivo.
 *
 * Qué se enseña depende de `nutrition_numbers` (ticket 01): con "ocultar" se
 * calcula igual, pero no aparece en ninguna parte.
 *
 * Puro (solo lógica, sin I/O): lo usan el cliente, el servidor y los tests.
 * Copia en `mobile/lib/energy.ts`.
 */

import { ageFromDOB } from "@/lib/age";
import { deriveGoalType, normalizeGoalType } from "@/lib/daily";
import { effectiveMealSlots, type MealSlot } from "@/lib/plan-shared";

import { parseTraining, routineDailyKcal, type TrainingRoutine } from "./exercise-energy";

// ---------------------------------------------------------------------------
// 1. Entradas normalizadas
// ---------------------------------------------------------------------------

/** Actividad del día a día, SIN contar el deporte (eso va en la rutina). */
export type DailyActivity = "sentado" | "de_pie" | "fisico" | "muy_fisico";

/** Factor de actividad física (PAL) de cada nivel. */
export const PAL: Record<DailyActivity, number> = {
  sentado: 1.2, // oficina, estudiar
  de_pie: 1.375, // tienda, docencia, casa con niños
  fisico: 1.55, // hostelería, reparto
  muy_fisico: 1.725, // obra, campo, almacén
};

export const DAILY_ACTIVITIES = Object.keys(PAL) as DailyActivity[];

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

/**
 * Traduce cualquier `activity_level` guardado a un nivel. Había CUATRO
 * vocabularios (Ajustes, extracción del onboarding, valor por defecto y perfil
 * demo) y en producción aparece además "moderada" (consulta de solo lectura,
 * 2026-09-25: ligero 30, activo 27, muy activo 22, moderada 1, sin dato 23).
 *
 * Esos valores antiguos mezclaban el día a día con el deporte, así que el PAL
 * que sale de aquí ya incluye el deporte: por eso, mientras el perfil no tenga
 * `daily_activity`, no se suma rutina (ver `energyTargets`). "Muy activo"
 * nunca cae en 1,375: con el mapeo original del ticket se perdía un 20 % del
 * gasto.
 */
export function normalizeActivity(raw: string | null | undefined): DailyActivity | null {
  const t = plain(String(raw ?? ""));
  if (!t) return null;
  if ((DAILY_ACTIVITIES as string[]).includes(t)) return t as DailyActivity;
  if (t.startsWith("sedentari")) return "sentado";
  if (/^muy activ|^alto|^alta|^muy fisic/.test(t)) return "muy_fisico";
  if (/^activ[oa] liger|^liger/.test(t)) return "de_pie";
  if (/^moderad|^activ/.test(t)) return "fisico";
  return null;
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type EnergyProfile = {
  sex?: string | null;
  date_of_birth?: string | null;
  age?: number | null;
  height_cm?: number | null;
  current_weight_kg?: number | null;
  start_weight_kg?: number | null;
  target_weight_kg?: number | null;
  goal_type?: string | null;
  pregnancy_status?: string | null;
  activity_level?: string | null;
  daily_activity?: string | null;
  training?: string | null;
  strength_training_experience?: string | null;
  meal_slots?: unknown;
  meals_to_plan?: string | null;
};

export type SlotTarget = { kcal: number; protein_g: number };

export type EnergyTargets = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  fiber_g: number;
  perSlot: Partial<Record<MealSlot, SlotTarget>>;
  basis: {
    /** Metabolismo basal (Mifflin-St Jeor). */
    bmr: number;
    /** Factor de actividad del día a día. */
    pal: number;
    /** kcal/día de la rutina de entrenamiento (0 en un perfil antiguo). */
    routineKcal: number;
    /** Gasto de mantenimiento: `bmr × pal + routineKcal`. */
    tdee: number;
    /** kcal del objetivo menos las de mantenimiento (negativo = déficit). */
    adjustment: number;
    /** Peso con el que se calcula la proteína. */
    refWeightKg: number;
    /** Perfil antiguo: el PAL sale de `activity_level`, que ya incluía el deporte. */
    legacyActivity: boolean;
    /** Dirección del objetivo que se aplicó. */
    goal: "perder" | "ganar" | "mantener" | "embarazo" | "lactancia";
  };
};

// ---------------------------------------------------------------------------
// 2-5. Cálculo
// ---------------------------------------------------------------------------

/** Constante sexual de Mifflin-St Jeor: +5 hombre, −161 mujer, −78 (la media) si no. */
const sexConstant = (sex: string | null | undefined): number => {
  const s = plain(String(sex ?? ""));
  if (/^(hombre|varon|masculin)/.test(s)) return 5;
  if (/^(mujer|femenin)/.test(s)) return -161;
  return -78;
};

const isWoman = (sex: string | null | undefined) => sexConstant(sex) === -161;
const isMan = (sex: string | null | undefined) => sexConstant(sex) === 5;

/** Reparto base del día por comida; se renormaliza sobre las que planifica. */
const SLOT_WEIGHTS: Record<MealSlot, number> = {
  desayuno: 0.25,
  comida: 0.35,
  cena: 0.28,
  snack: 0.12,
};

function goalOf(p: EnergyProfile): "perder" | "ganar" | "mantener" | null {
  if (p.target_weight_kg != null) {
    const current = p.current_weight_kg ?? p.start_weight_kg ?? p.target_weight_kg;
    return deriveGoalType(Number(current), Number(p.target_weight_kg));
  }
  const legacy = p.goal_type ? normalizeGoalType(String(p.goal_type)) : null;
  return legacy === "perder" || legacy === "ganar" || legacy === "mantener" ? legacy : null;
}

/** ¿Entrena fuerza? Por la experiencia declarada o por su rutina. */
function trainsStrength(p: EnergyProfile, routine: TrainingRoutine | null): boolean {
  const exp = plain(String(p.strength_training_experience ?? ""));
  if (exp && exp !== "ninguna" && exp !== "ninguno") return true;
  return !!routine?.sessionsPerWeek && routine.activity === "Gimnasio / pesas";
}

/**
 * kcal y macros del día, y su reparto por comida. `null` cuando la fórmula no
 * vale o faltan datos: menor de 18 (no está validada), o sin altura, peso o
 * edad. En ese caso la app se comporta como antes de este ticket.
 */
export function energyTargets(p: EnergyProfile | null | undefined): EnergyTargets | null {
  if (!p) return null;
  const kg = Number(p.current_weight_kg);
  const cm = Number(p.height_cm);
  const age = ageFromDOB(p.date_of_birth) ?? (p.age != null ? Number(p.age) : null);
  if (!(kg > 0) || !(cm > 0) || age == null || !Number.isFinite(age)) return null;
  if (age < 18) return null;

  // 2. Gasto.
  const bmr = Math.round(10 * kg + 6.25 * cm - 5 * age + sexConstant(p.sex));
  const daily = normalizeActivity(p.daily_activity);
  const legacyActivity = !daily;
  const level = daily ?? normalizeActivity(p.activity_level) ?? "de_pie";
  const pal = PAL[level];
  // Un perfil antiguo no suma rutina: su PAL ya la incluía (D9).
  const routine = legacyActivity ? null : parseTraining(p.training);
  const routineKcal = routineDailyKcal(routine, kg);
  const tdee = Math.round(bmr * pal + routineKcal);

  // 3. Ajuste por objetivo. Una fecha que pida más ritmo NO cambia estos
  //    topes: se ajusta la fecha, no el hambre (misma regla que el coach).
  const pregnancy = plain(String(p.pregnancy_status ?? ""));
  let goal: EnergyTargets["basis"]["goal"] = goalOf(p) ?? "mantener";
  let kcal = tdee;
  if (pregnancy === "embarazada") {
    goal = "embarazo";
    kcal = tdee + 300; // nunca déficit; no sabemos el trimestre
  } else if (pregnancy === "lactancia") {
    goal = "lactancia";
    kcal = tdee + 400;
  } else if (goal === "perder") {
    const floor = Math.max(bmr, isWoman(p.sex) ? 1200 : isMan(p.sex) ? 1500 : 1350);
    kcal = Math.max(Math.max(tdee * 0.8, tdee - 500), floor);
  } else if (goal === "ganar") {
    kcal = Math.min(tdee * 1.1, tdee + 300);
  }
  kcal = Math.round(kcal);

  // 4. Macros.
  const heightM = cm / 100;
  const bmi = kg / (heightM * heightM);
  const refWeightKg = Math.round((bmi > 30 ? 27 * heightM * heightM : kg) * 10) / 10;
  const perKg = goal === "perder" || trainsStrength(p, routine) ? 1.6 : 1.2;
  const protein_g = Math.round(Math.min(perKg * refWeightKg, 2.0 * refWeightKg, (0.3 * kcal) / 4));
  const fat_g = Math.round((0.3 * kcal) / 9);
  const fiber_g = Math.round((14 * kcal) / 1000);
  const carbs_g = Math.max(0, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4));

  // 5. Reparto por comida, sobre las que planifica.
  const slots = effectiveMealSlots(p);
  const weightSum = slots.reduce((sum, s) => sum + SLOT_WEIGHTS[s], 0) || 1;
  const perSlot: Partial<Record<MealSlot, SlotTarget>> = {};
  for (const slot of slots) {
    const share = SLOT_WEIGHTS[slot] / weightSum;
    perSlot[slot] = { kcal: Math.round(kcal * share), protein_g: Math.round(protein_g * share) };
  }

  return {
    kcal,
    protein_g,
    fat_g,
    carbs_g,
    fiber_g,
    perSlot,
    basis: {
      bmr,
      pal,
      routineKcal,
      tdee,
      adjustment: kcal - tdee,
      refWeightKg,
      legacyActivity,
      goal,
    },
  };
}

// ---------------------------------------------------------------------------
// 7. Una sola cifra en toda la app
// ---------------------------------------------------------------------------

/** Redondeo a 50 kcal, el grano de un rango que se lee de un vistazo. */
const round50 = (n: number) => Math.round(n / 50) * 50;

/**
 * El texto de "calorías del día" de la guía, escrito en código a partir del
 * objetivo (antes lo escribía el modelo y convivía con otra cifra en la misma
 * pantalla, H13): el objetivo ±7 %, redondeado a 50. Sin objetivo o sin ver
 * cifras, un texto sin números.
 */
export function caloriesText(targets: EnergyTargets | null, showNumbers: boolean): string {
  if (!showNumbers) return "Platos completos y a tu ritmo, sin mirar números.";
  if (!targets) return "Rango orientativo según tu día, sin obsesión por la cifra.";
  const low = round50(targets.kcal * 0.93);
  const high = round50(targets.kcal * 1.07);
  const fmt = (n: number) => n.toLocaleString("es-ES");
  return `entre ${fmt(low)} y ${fmt(high)} kcal`;
}

/** Forma de `MacroEstimate` del objetivo, para la barra de macros y el semáforo. */
export const targetsAsMacros = (t: EnergyTargets) => ({
  kcal: t.kcal,
  protein_g: t.protein_g,
  carbs_g: t.carbs_g,
  fat_g: t.fat_g,
  fiber_g: t.fiber_g,
});

/**
 * Cómo se ha calculado, en una frase, para Ajustes (transparencia: la persona
 * ve de dónde sale su cifra, igual que en la tarjeta "Balance de hoy").
 */
export function energyExplanation(t: EnergyTargets): string {
  const n = (x: number) => Math.round(x).toLocaleString("es-ES");
  const pal = t.basis.pal.toLocaleString("es-ES", { maximumFractionDigits: 3 });
  const routine = t.basis.routineKcal ? ` + rutina ${n(t.basis.routineKcal)}` : "";
  const pct = t.basis.tdee ? Math.round((t.basis.adjustment / t.basis.tdee) * 100) : 0;
  const goal =
    t.basis.adjustment === 0
      ? "para mantenerte"
      : `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %${
          t.basis.goal === "embarazo" || t.basis.goal === "lactancia" ? ` (${t.basis.goal})` : ""
        }`;
  return (
    `Gasto estimado: ${n(t.basis.tdee)} kcal (basal ${n(t.basis.bmr)} × actividad ${pal}${routine}). ` +
    `Objetivo: ${n(t.kcal)} kcal ${goal} y ${n(t.protein_g)} g de proteína.`
  );
}
