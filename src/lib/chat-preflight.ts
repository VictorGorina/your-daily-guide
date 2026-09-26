import type { UIMessage } from "ai";

import { offTopicReason, type OffTopicReason } from "@/lib/coach-scope";
import { RateLimitError } from "@/lib/rate-limit-error";

/** El último mensaje de la persona, que es sobre el que se decide. */
export function lastUserMessage(messages: UIMessage[]): UIMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]!;
  }
  return null;
}

export function lastUserText(messages: UIMessage[]): string {
  return (lastUserMessage(messages)?.parts ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
}

export type ChatPreflight =
  | { kind: "no-messages" }
  | { kind: "off-topic"; reason: OffTopicReason; messages: UIMessage[]; locale: string | null }
  | { kind: "no-key" }
  | { kind: "rate-limited"; error: RateLimitError }
  | { kind: "ok"; key: string; messages: UIMessage[] };

/**
 * Lo que `/api/chat` decide antes de montar el prompt, en su orden. Fuera de
 * alcance se corta ANTES de la clave, de la cuota y del modelo, así que un
 * intento no cuesta ni cupo ni dinero. La regla de verdad sobre qué es tema del
 * coach vive en `coachSystemPrompt`; esto solo adelanta el caso más común (ver
 * `coach-scope.ts`).
 *
 * La clave y la cuota llegan inyectadas para que un test compruebe ese orden.
 * Un error de la cuota que no sea `RateLimitError` sube tal cual.
 */
export async function chatPreflight(
  body: { messages?: unknown; profile?: Record<string, unknown> | null },
  deps: { readKey: () => string | undefined; consumeQuota: () => Promise<void> },
): Promise<ChatPreflight> {
  if (!Array.isArray(body.messages)) return { kind: "no-messages" };
  const messages = body.messages as UIMessage[];

  const locale = (body.profile as { locale?: string | null } | null)?.locale ?? null;
  const offTopic = offTopicReason(lastUserText(messages));
  if (offTopic) return { kind: "off-topic", reason: offTopic, messages, locale };

  const key = deps.readKey();
  if (!key) return { kind: "no-key" };

  try {
    await deps.consumeQuota();
  } catch (error) {
    if (error instanceof RateLimitError) return { kind: "rate-limited", error };
    throw error;
  }
  return { kind: "ok", key, messages };
}
