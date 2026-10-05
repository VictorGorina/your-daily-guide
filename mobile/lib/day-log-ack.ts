import type { ExerciseEntry } from "./exercise";
import type { SnackEntry } from "./snacks";
import type { Translate } from "./week-nav";

/**
 * Lo que desvía el día y se apunta desde el chat —deporte y picoteo, por el
 * registro guiado o por la herramienta `registrar_deporte` del coach— se guarda
 * igual que en Hoy (`logExercise`, `logSnack`) y entra en el MISMO asentamiento
 * del día (`day-settle.ts`). El coach nunca lo compensa por su cuenta con
 * `ajustar_plan_mensual`: eso decidía por origen (saltándose `settleDay`),
 * con una cifra estimada por el modelo, y compensaba también las sesiones que
 * ya van dentro del objetivo por ser de la rutina (ticket 16 de
 * `precision-nutricional`, D9).
 *
 * Tras el registro guiado, al coach solo le llega un aviso para que acuse
 * recibo. Dos marcas, cada una para una cosa:
 *
 * - `LOGGED_ACK_METADATA` viaja en el `metadata` del mensaje y hace que
 *   `/api/chat` conteste ESE turno sin herramientas. Va en el metadata y no en
 *   el texto para que escribir la frase a mano no deje al coach sin
 *   herramientas.
 * - Los prefijos (`ACK_PREFIXES`) son lo que queda en el historial (solo se
 *   guarda el texto): el prompt le dice al coach que esos mensajes ya están
 *   apuntados y nunca se compensan ni se vuelven a registrar, tampoco en
 *   turnos posteriores. El mensaje sale en el idioma de la persona (ticket 34),
 *   así que hay un prefijo por idioma: un test los ata al catálogo.
 *
 * Copia de `src/lib/day-log-ack.ts` de la web (no hay código compartido).
 */

export const EXERCISE_ACK_PREFIX = "He registrado deporte:";
export const SNACK_ACK_PREFIX = "He apuntado un picoteo:";

/** Todos los prefijos que el prompt reconoce, en cada idioma de la interfaz. */
export const ACK_PREFIXES = {
  exercise: [EXERCISE_ACK_PREFIX, "I logged exercise:"],
  snack: [SNACK_ACK_PREFIX, "I logged a snack:"],
} as const satisfies Record<"exercise" | "snack", readonly string[]>;

export type LoggedKind = "exercise" | "snack";

export const LOGGED_ACK_METADATA = {
  exercise: { logged: "exercise" },
  snack: { logged: "snack" },
} as const satisfies Record<LoggedKind, { logged: LoggedKind }>;

/** Qué se acaba de apuntar según el `metadata` del mensaje, o `null` si nada. */
export function loggedAckKind(metadata: unknown): LoggedKind | null {
  if (!metadata || typeof metadata !== "object") return null;
  const logged = (metadata as { logged?: unknown }).logged;
  return logged === "exercise" || logged === "snack" ? logged : null;
}

/** "correr 30 min, intensidad normal" */
const describeSession = (entry: Pick<ExerciseEntry, "activity" | "minutes" | "intensity">) =>
  `${entry.activity.toLowerCase()} ${entry.minutes} min, intensidad ${entry.intensity.toLowerCase()}`;

/**
 * La cifra es la que ha entrado en el balance del día (`entry.kcal`, negativo),
 * la calcula `logExercise` y no el cliente: con el ticket 16 deja fuera lo que
 * la rutina ya lleva dentro del objetivo. Sin cifra con la preferencia de no
 * verlas (ticket 01) o si no hay extra.
 */
const exerciseKcalNote = (entry: Pick<ExerciseEntry, "kcal">, showNumbers: boolean) => {
  const extra = Math.round(-entry.kcal);
  return showNumbers && extra > 0 ? ` (≈ ${extra} kcal de gasto extra)` : "";
};

/**
 * Lo que la persona "dice" en el chat tras guardar el deporte en el registro
 * guiado. Con traductor, en su idioma; sin él, el español de siempre.
 */
export function exerciseAckMessage(
  entry: Pick<ExerciseEntry, "activity" | "minutes" | "intensity" | "kcal">,
  showNumbers: boolean,
  t?: Translate,
): string {
  if (!t) {
    return `${EXERCISE_ACK_PREFIX} ${describeSession(entry)}${exerciseKcalNote(entry, showNumbers)}.`;
  }
  const extra = Math.round(-entry.kcal);
  return t("chat.ack.exercise", {
    activity: t(`exercise.activities.${entry.activity}`, {
      defaultValue: entry.activity,
    }).toLowerCase(),
    minutes: entry.minutes,
    intensity: t(`exercise.intensity.${entry.intensity}`, {
      defaultValue: entry.intensity,
    }).toLowerCase(),
    kcal: showNumbers && extra > 0 ? t("chat.ack.exerciseKcal", { kcal: extra }) : "",
  });
}

/** Lo que la persona "dice" en el chat tras guardar un picoteo en el registro guiado. */
export function snackAckMessage(
  entry: Pick<SnackEntry, "text" | "kcal">,
  showNumbers: boolean,
  t?: Translate,
): string {
  const shown = showNumbers && entry.kcal > 0 ? Math.round(entry.kcal) : null;
  if (!t) return `${SNACK_ACK_PREFIX} ${entry.text}${shown ? ` (≈ ${shown} kcal)` : ""}.`;
  return t("chat.ack.snack", {
    text: entry.text,
    kcal: shown ? t("chat.ack.snackKcal", { kcal: shown }) : "",
  });
}

/**
 * Resultado de la herramienta `registrar_deporte` para el coach. Le dice qué
 * ha quedado apuntado y que la compensación no es cosa suya, para que no
 * encadene un `ajustar_plan_mensual` ni prometa cambios que no ha hecho.
 */
export function exerciseToolResult(
  entry: Pick<ExerciseEntry, "activity" | "minutes" | "intensity" | "kcal">,
  showNumbers: boolean,
): string {
  return (
    `Deporte apuntado en el día de hoy: ${describeSession(entry)}${exerciseKcalNote(entry, showNumbers)}. ` +
    "La app suma el día entero y, si hace falta, repone energía en los próximos días ella sola; " +
    "la persona lo verá en «Balance de hoy», en la pestaña Hoy. Confírmale en una frase que lo has " +
    "apuntado y dónde lo verá. No llames a ajustar_plan_mensual ni a recalcular_objetivo por esta sesión."
  );
}
