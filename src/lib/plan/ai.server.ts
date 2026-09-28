import { COACH_MODEL, createAiProvider } from "@/lib/ai-provider.server";
import { type Deadline, hasTimeFor, stepTimeout } from "@/lib/deadline";
import { logEvent } from "@/lib/log.server";
import {
  cleanShopping,
  formatShoppingQty,
  parseJsonLoose,
  type ShoppingList,
  shoppingTotal,
} from "@/lib/plan-shared";
import { RateLimitError } from "@/lib/rate-limit-error";
import { generateText, streamText } from "ai";
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
  },
  extract: (parsed: unknown) => T | null,
  attempts = 3,
): Promise<T> {
  const ai = createAiProvider(opts.key, opts.userId);
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

/**
 * Garantiza que la lista no supere el presupuesto. Primero pide al modelo que la
 * recorte con números concretos; si aun así se pasa, escala la compra de forma
 * proporcional como último recurso (`scaleShoppingToBudget`: cantidad y precio a
 * la vez) para que el total nunca exceda el tope. Es best-effort: si el recorte
 * por IA falla, no rompe la generación.
 */
export async function enforceBudget(
  key: string,
  userId: string,
  system: string,
  shopping: ShoppingList,
  target: number,
  sym = "€",
  model = COACH_MODEL,
  deadline?: Deadline,
): Promise<ShoppingList> {
  if (!(target > 0) || shoppingTotal(shopping) <= target * 1.02) return shopping;

  let result = shopping;
  // Sin tiempo para el recorte con IA, el escalado de abajo cumple el tope igual.
  const timeoutMs = stepTimeout(Infinity, deadline);
  try {
    if (deadline && !hasTimeFor(timeoutMs)) throw new Error("sin tiempo para el recorte con IA");
    const ai = createAiProvider(key, userId);
    const { text } = await generateText({
      model: ai(model),
      ...(Number.isFinite(timeoutMs) ? { abortSignal: AbortSignal.timeout(timeoutMs) } : {}),
      system,
      temperature: 0.2,
      prompt:
        `Lista de la compra actual (JSON): ${JSON.stringify(shopping)}\n` +
        `Suma ${shoppingTotal(shopping)} ${sym} y el tope es ${target} ${sym}.\n` +
        `Recórtala hasta NO superar ${target} ${sym}: baja "weekQty" y "weekPrice" a la vez, elige alternativas más baratas y quita lo prescindible, manteniendo una compra equilibrada y platos cocinables. ` +
        "Conserva EXACTAMENTE la misma estructura (claves category/items/name/unit/weekQty/weekPrice/perishable; weekQty y weekPrice son arrays de 4, uno por semana). " +
        'Devuelve solo JSON: {"shopping": [...]}',
    });
    const parsed = (parseJsonLoose(text) ?? {}) as { shopping?: unknown };
    const cleaned = cleanShopping(parsed.shopping ?? parsed);
    if (cleaned.length) result = cleaned;
  } catch (e) {
    console.error("enforceBudget", e);
  }

  const total = shoppingTotal(result);
  if (total > target && total > 0) {
    result = scaleShoppingToBudget(result, target / total);
  }
  return result;
}

/**
 * Último recurso si el recorte por IA no bastó: escala la compra por un factor
 * < 1. En la lista canónica baja `weekQty` y `weekPrice` juntos (bajar solo el
 * precio dejaría cantidad y coste contradiciéndose); en una lista antigua solo
 * puede tocar el precio.
 */
const scaleShoppingToBudget = (shopping: ShoppingList, factor: number): ShoppingList =>
  shopping.map((g) => ({
    ...g,
    items: g.items.map((i) => {
      if (Array.isArray(i.weekQty)) {
        const weekQty = i.weekQty.map((n) => Math.round(n * factor * 100) / 100);
        const weekPrice = (i.weekPrice ?? []).map((n) => Math.round(n * factor * 100) / 100);
        return {
          ...i,
          weekQty,
          weekPrice,
          qty: formatShoppingQty(
            i.name,
            weekQty.reduce((s, n) => s + n, 0),
            i.unit ?? "ud",
          ),
          price_eur: Math.round(weekPrice.reduce((s, n) => s + n, 0) * 100) / 100,
        };
      }
      return { ...i, price_eur: Math.round(i.price_eur * factor * 100) / 100 };
    }),
  }));
