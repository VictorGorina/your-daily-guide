import type { UIMessage } from "ai";

/**
 * Validación del cuerpo de `/api/chat` (ticket 08 de la auditoría, SEC-S-02 y
 * SEC-S-06). Puro: lo usa la ruta y lo prueban los tests.
 *
 * Antes el cuerpo se casteaba sin mirar: sin tope de tamaño ni de mensajes, y
 * `convertToModelMessages` aceptaba cualquier rol (también `system`, que salta
 * el alcance del coach) y cualquier parte (`file` con una URL, herramientas
 * inventadas). Aquí se decide qué pasa:
 *
 * - Lo que es la PETICIÓN (los mensajes) se valida: si no cuadra, 400/413.
 * - Lo que es CONTEXTO (guía, registro, próximos días, compra, despensa) se
 *   recorta o se descarta, pero nunca tumba la petición.
 * - El perfil del cuerpo no se usa: la ruta lo lee de la base de datos.
 */

export const CHAT_LIMITS = {
  bodyBytes: 256 * 1024,
  messages: 100,
  textPartChars: 8_000,
  guideBytes: 20_000,
  logBytes: 20_000,
  proximos: 14,
  proximoChars: 600,
  listItems: 300,
  listItemChars: 80,
} as const;

/**
 * Las herramientas del coach. `chat.ts` comprueba con `satisfies` que
 * `actionTools` tiene exactamente estas: una herramienta nueva que no esté
 * aquí no compila, en vez de rechazarse en producción.
 */
export const ACTION_TOOL_NAMES = [
  "actualizar_peso",
  "marcar_habito",
  "anadir_habito",
  "quitar_habito",
  "regenerar_guia",
  "cambiar_plato",
  "cambiar_plato_nino",
  "registrar_deporte",
  "ajustar_plan_mensual",
  "recalcular_objetivo",
  "cambiar_fecha_objetivo",
  "actualizar_perfil",
] as const;

export type ActionToolName = (typeof ACTION_TOOL_NAMES)[number];

/** Partes que puede traer un mensaje del asistente, aparte de sus herramientas. */
const ASSISTANT_PARTS = new Set(["text", "reasoning", "step-start"]);
const TOOL_NAMES = new Set<string>(ACTION_TOOL_NAMES);

export type ChatBody = {
  messages: UIMessage[];
  guide?: unknown;
  log?: unknown;
  actions?: boolean;
  today?: string;
  compra?: { confirmada: boolean; ingredientes: string[] } | null;
  despensa_extra?: string[];
  proximos?: Record<string, string>[];
};

export type ChatBodyResult =
  { ok: true; body: ChatBody } | { ok: false; status: 400 | 413; reason: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Motivo por el que un mensaje no vale, o `null` si vale. */
function messageProblem(message: unknown): string | null {
  if (!isRecord(message)) return "message-not-object";
  if (typeof message.id !== "string") return "message-without-id";
  const role = message.role;
  if (role !== "user" && role !== "assistant") return `role:${String(role)}`;
  if (!Array.isArray(message.parts)) return "parts-not-array";

  for (const part of message.parts) {
    if (!isRecord(part) || typeof part.type !== "string") return "part-not-object";
    const type = part.type;
    if (role === "user") {
      if (type !== "text") return `user-part:${type}`;
      if (typeof part.text !== "string") return "text-not-string";
      if (part.text.length > CHAT_LIMITS.textPartChars) return "text-too-long";
      continue;
    }
    if (ASSISTANT_PARTS.has(type)) continue;
    if (type.startsWith("tool-")) {
      const name = type.slice("tool-".length);
      if (TOOL_NAMES.has(name)) continue;
      return `tool:${name}`;
    }
    return `assistant-part:${type}`;
  }
  return null;
}

/** Contexto en JSON que no pase de `maxBytes`; si pasa, se descarta. */
const withinBytes = (value: unknown, maxBytes: number): unknown => {
  if (value == null) return undefined;
  try {
    return JSON.stringify(value).length <= maxBytes ? value : undefined;
  } catch {
    return undefined;
  }
};

/** Lista de nombres cortos (ingredientes, despensa), recortada. */
const cleanList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === "string")
        .slice(0, CHAT_LIMITS.listItems)
        .map((v) => v.slice(0, CHAT_LIMITS.listItemChars))
    : [];

const cleanProximos = (value: unknown): Record<string, string>[] =>
  Array.isArray(value)
    ? value
        .filter(isRecord)
        .slice(0, CHAT_LIMITS.proximos)
        .map((entry) =>
          Object.fromEntries(
            Object.entries(entry)
              .filter((kv): kv is [string, string] => typeof kv[1] === "string")
              .map(([k, v]) => [k, v.slice(0, CHAT_LIMITS.proximoChars)]),
          ),
        )
    : [];

/**
 * Valida y recorta el cuerpo ya parseado. `rawBytes` es el tamaño del texto
 * recibido (la ruta corta antes de parsear si ya se pasa).
 */
export function cleanChatBody(raw: unknown, rawBytes: number): ChatBodyResult {
  if (rawBytes > CHAT_LIMITS.bodyBytes) return { ok: false, status: 413, reason: "body-too-large" };
  if (!isRecord(raw)) return { ok: false, status: 400, reason: "body-not-object" };
  if (!Array.isArray(raw.messages)) return { ok: false, status: 400, reason: "no-messages" };
  if (raw.messages.length > CHAT_LIMITS.messages) {
    return { ok: false, status: 400, reason: "too-many-messages" };
  }
  for (const message of raw.messages) {
    const problem = messageProblem(message);
    if (problem) return { ok: false, status: 400, reason: problem };
  }

  const body: ChatBody = { messages: raw.messages as UIMessage[] };
  const guide = withinBytes(raw.guide, CHAT_LIMITS.guideBytes);
  if (guide !== undefined) body.guide = guide;
  const log = withinBytes(raw.log, CHAT_LIMITS.logBytes);
  if (log !== undefined) body.log = log;
  if (typeof raw.actions === "boolean") body.actions = raw.actions;
  if (typeof raw.today === "string" && ISO_DATE.test(raw.today)) body.today = raw.today;
  if (isRecord(raw.compra)) {
    body.compra = {
      confirmada: raw.compra.confirmada === true,
      ingredientes: cleanList(raw.compra.ingredientes),
    };
  } else if (raw.compra === null) {
    body.compra = null;
  }
  if (raw.despensa_extra !== undefined) body.despensa_extra = cleanList(raw.despensa_extra);
  if (raw.proximos !== undefined) body.proximos = cleanProximos(raw.proximos);
  return { ok: true, body };
}
