import { COACH_MODEL, createAiProvider } from "@/lib/ai-provider.server";
import type { SpendCapScope } from "@/lib/ai-spend";
import { type Deadline, hasTimeFor, stepTimeout } from "@/lib/deadline";
import { logEvent } from "@/lib/log.server";
import { parseJsonLoose } from "@/lib/plan-shared";
import { RateLimitError } from "@/lib/rate-limit-error";
import { streamText } from "ai";
import { UserFacingError } from "@/lib/validation-error";

/** Pide el JSON al modelo en streaming (evita cortes por timeout) y lo intenta varias veces. */
export async function askForJson<T>(
  opts: {
    key: string;
    userId: string;
    system: string;
    prompt: string;
    model?: string;
    /**
     * Presupuesto de la petición (ticket 22): cada intento se corta a lo que
     * queda y, si no queda lo bastante, no se hace otro. Sin él, sin límite.
     */
    deadline?: Deadline;
    /** `month` solo para generar y ajustar el plan del mes (ver `SpendCapScope`). */
    capScope?: SpendCapScope;
  },
  extract: (parsed: unknown) => T | null,
  attempts = 3,
): Promise<T> {
  const ai = createAiProvider(opts.key, opts.userId, { capScope: opts.capScope });
  let lastError: unknown = null;

  for (let i = 0; i < attempts; i++) {
    const timeoutMs = stepTimeout(Infinity, opts.deadline);
    if (opts.deadline && !hasTimeFor(timeoutMs)) {
      logEvent("warn", "ai_step_no_time", { step: "ask_for_json", attempt: i });
      break;
    }
    // Un error del modelo en streaming no llega tal cual a `result.text` (que
    // rechaza con un genérico "No output generated"), solo a `onError`.
    let streamError: unknown = null;
    try {
      const result = streamText({
        model: ai(opts.model ?? COACH_MODEL),
        ...(Number.isFinite(timeoutMs) ? { abortSignal: AbortSignal.timeout(timeoutMs) } : {}),
        system: opts.system,
        prompt:
          i === 0
            ? opts.prompt
            : `${opts.prompt}\n\nIMPORTANTE: el intento anterior no fue válido. Devuelve EXCLUSIVAMENTE el JSON completo y cerrado, sin markdown, sin comentarios y sin texto antes o después.`,
        temperature: i === 0 ? 0.7 : 0.3,
        onError: ({ error }) => {
          streamError = error;
          // Sustituye al log por defecto del SDK; el tope ya se registra al saltar.
          if (!(error instanceof RateLimitError)) console.error("askForJson stream", error);
        },
      });
      const text = await result.text;
      const value = extract(parseJsonLoose(text));
      if (value) return value;
      lastError = new Error("JSON incompleto");
    } catch (e) {
      // Tope de gasto: reintentar no lo cambia y el mensaje ya viene escrito
      // para la persona, así que sube tal cual (429 en `apiPost`).
      if (streamError instanceof RateLimitError) throw streamError;
      if (e instanceof RateLimitError) throw e;
      lastError = streamError ?? e;
    }
  }

  console.error("askForJson agotó los intentos", lastError);
  throw new UserFacingError(
    "No hemos podido crear el plan ahora mismo. Inténtalo otra vez en un momento.",
  );
}
