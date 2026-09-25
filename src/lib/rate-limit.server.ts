import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decideSpendCap,
  spendCapBlocks,
  utcMonthStartISO,
  type AiSpendCaps,
  type SpendCapDecision,
  type SpendCapScope,
} from "@/lib/ai-spend";
import { RateLimitError } from "@/lib/rate-limit-error";

/**
 * Cuota por persona y operación, contra la tabla `rate_limits` (ver la
 * migración `rate_limits`). Protege sobre todo lo que cuesta dinero: cada
 * generación de plan, guía, receta o mensaje al coach es una llamada de pago a
 * OpenRouter, y hasta ahora cualquier cuenta con sesión podía dispararlas sin
 * tope.
 *
 * Los límites están puestos con holgura: no buscan racionarle el uso a nadie,
 * solo poner un techo a lo que una sola cuenta puede gastar en una hora
 * (`RATE_LIMITS`) y, sumando todas las operaciones, en un día o un mes
 * (`AI_SPEND_CAPS`). Si a alguien le queda corto, se sube aquí sin tocar la base
 * de datos.
 *
 * Este módulo importa `client.server` arriba del todo (permitido en un
 * `.server.ts`), así que desde un `*.functions.ts` hay que cargarlo con
 * `await import(...)` dentro del handler, nunca con un import estático: esos
 * archivos también se empaquetan para el navegador.
 */
const HOUR = 3600;

const RATE_LIMITS = {
  chat: { limit: 60, windowSeconds: HOUR, action: "hablar con el coach" },
  "plan-generate": { limit: 8, windowSeconds: HOUR, action: "generar el plan" },
  "plan-adjust": { limit: 30, windowSeconds: HOUR, action: "reajustar el plan" },
  // Recálculo automático al cambiar la despensa o la mesa (issue 05). Bucket
  // propio y con holgura: agrupado por el debounce del cliente, no lo dispara
  // la persona a mano, y así un bucle accidental no vacía la cuota real de
  // `plan-generate` ni `plan-adjust`.
  "plan-reflow": { limit: 12, windowSeconds: HOUR, action: "actualizar el plan con los cambios" },
  "child-meals": { limit: 20, windowSeconds: HOUR, action: "actualizar el menú de los peques" },
  guide: { limit: 30, windowSeconds: HOUR, action: "pedir la guía de hoy" },
  "onboarding-parse": { limit: 30, windowSeconds: HOUR, action: "guardar tus respuestas" },
  receipt: { limit: 20, windowSeconds: HOUR, action: "escanear un tiquet" },
  recipe: { limit: 40, windowSeconds: HOUR, action: "pedir una receta" },
  // Calcular las kcal de un picoteo antes de guardarlo (`picoteo-hoy`). La
  // compensación que pueda venir después gasta de `plan-adjust`.
  "snack-estimate": { limit: 40, windowSeconds: HOUR, action: "calcular el picoteo" },
  // Calcular de antemano los platos del plan del mes (ticket 06 de
  // `precision-nutricional`): ~8 platos por llamada, ~10 llamadas por plan. Un
  // plato ya en la caché global no cuesta nada.
  "recipe-warm": { limit: 60, windowSeconds: HOUR, action: "calcular los platos del plan" },
  "coach-aux": { limit: 40, windowSeconds: HOUR, action: "pedirle esto al coach" },
  // Sin sesión y por correo, no por cuenta. Se suman al freno de 60 s que ya hay
  // en memoria en `auth.functions.ts`.
  "password-reset": { limit: 5, windowSeconds: HOUR, action: "pedir el enlace" },
  "signup-confirm": { limit: 5, windowSeconds: HOUR, action: "pedir el correo de confirmación" },
} as const;

/**
 * Tope de gasto en IA por persona, en dólares de OpenRouter. Complementa a
 * `RATE_LIMITS`, no lo sustituye: esas cuotas son por hora, y una cuenta
 * automatizada que las respete todas puede gastar ~50-70 $/mes POR operación.
 *
 * Una persona que usa mucho la app gastaba ~0,85 $/mes solo con `COACH_MODEL`
 * (medido el 2026-09-15: un mensaje al coach ≈ 0,0014 $, la guía ≈ 0,0013 $, el
 * plan del mes ≈ 0,01 $). Desde que `PLAN_MODEL`/`DISH_MODEL` (Gemini 2.5 Pro,
 * ~4x el precio de Flash) llevan la generación/reajuste del plan y la
 * descomposición de platos (issue "reorganizar IAs", 2026-09-19), el gasto
 * intensivo proyectado sube pero se queda bien por debajo de este tope — el
 * chat, con más volumen que nada, se queda en Flash sin cambios.
 *
 * El día y el mes van en UTC (ver `ai-spend.ts`). `Infinity` desactiva un tope.
 */
const AI_SPEND_CAPS: AiSpendCaps = { dailyUsd: 0.75, monthlyUsd: 5 };

export type RateLimitBucket = keyof typeof RATE_LIMITS;

type Consumed = { allowed: boolean; retryAfterSeconds: number };

async function consume(subject: string, bucket: RateLimitBucket): Promise<Consumed> {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
    _subject: subject,
    _bucket: bucket,
    _limit: limit,
    _window_seconds: windowSeconds,
  });

  if (error) {
    // Se deja pasar a propósito. Si la tabla no existe todavía (migración sin
    // aplicar) o la base de datos falla, cerrar el paso dejaría la app sin
    // coach, sin plan y sin guía: convertiríamos un problema de infraestructura
    // en una caída de producto. Queda en el log para que se vea, porque
    // mientras esto falle no hay tope de gasto.
    console.error("consume_rate_limit", error);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { allowed: true, retryAfterSeconds: 0 };
  return {
    allowed: row.allowed !== false,
    retryAfterSeconds: Number(row.retry_after_seconds) || 0,
  };
}

/**
 * Cuánto lleva gastado la persona y si puede hacer otra llamada, contra la
 * tabla `ai_spend` (migración `ai_spend`). Igual que `consume`, si la lectura
 * falla se deja pasar y queda en el log: mientras falle no hay tope de gasto,
 * pero la app sigue teniendo coach.
 */
async function spendCapDecision(userId: string): Promise<SpendCapDecision | null> {
  const now = new Date();
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_spend")
      .select("day, cost_usd")
      .eq("user_id", userId)
      .gte("day", utcMonthStartISO(now));
    if (error) throw error;
    const decision = decideSpendCap(data ?? [], AI_SPEND_CAPS, now);
    if (!decision.allowed) {
      // Llegar aquí usando la app con normalidad es casi imposible (ver
      // AI_SPEND_CAPS): si se repite para una cuenta, merece un vistazo.
      console.warn("ai_spend cap", {
        userId,
        scope: decision.scope,
        daySpentUsd: decision.daySpentUsd,
        monthSpentUsd: decision.monthSpentUsd,
      });
    }
    return decision;
  } catch (error) {
    console.error("ai_spend read", error);
    return null;
  }
}

/**
 * Tope de gasto en IA antes de UNA llamada al modelo. Lo usa el middleware de
 * `createAiProvider` en cada llamada, para que ninguna se escape del tope
 * aunque su server function no pase por `enforceUserRateLimit` (p. ej.
 * `resolveDish` al cambiar un plato). `action` va genérica porque ahí no se
 * sabe qué operación la pidió.
 */
export async function enforceAiSpendCap(
  userId: string,
  action = "usar el coach",
  capScope: SpendCapScope = "day",
): Promise<void> {
  const decision = await spendCapDecision(userId);
  if (decision && !decision.allowed && spendCapBlocks(decision, capScope)) {
    throw new RateLimitError(decision.retryAfterSeconds, action, decision.scope);
  }
}

/**
 * Suma el coste real de una llamada al día UTC de la persona. Nunca lanza: si
 * la escritura falla, la respuesta de la IA ya está pagada y hecha, y romperla
 * no arreglaría nada; queda en el log (y esa llamada fuera del tope).
 */
export async function recordAiSpend(userId: string, costUsd: number): Promise<void> {
  if (!(costUsd > 0)) return;
  try {
    const { error } = await supabaseAdmin.rpc("record_ai_spend", {
      _user_id: userId,
      _cost_usd: costUsd,
    });
    if (error) throw error;
  } catch (error) {
    console.error("record_ai_spend", error);
  }
}

/**
 * Cuota de una cuenta con sesión. Lanza `RateLimitError` (HTTP 429) cuando se
 * ha pasado, con el mensaje ya escrito para enseñarlo en pantalla.
 *
 * Todas las cuotas por cuenta protegen llamadas a la IA, así que aquí se mira
 * también el tope de gasto (`AI_SPEND_CAPS`): así se corta en la entrada, antes
 * de leer el perfil o montar el prompt, y con la acción concreta en el mensaje.
 * Se consulta a la vez que la cuota horaria para no sumar otra espera. El
 * middleware de `createAiProvider` lo vuelve a mirar antes de cada llamada.
 *
 * `userId` sale siempre del `sub` del JWT ya verificado por
 * `requireSupabaseAuth`, nunca del cuerpo de la petición: si lo eligiera quien
 * llama, podría gastarle la cuota a otra persona.
 */
export async function enforceUserRateLimit(
  userId: string,
  bucket: RateLimitBucket,
  /** `month` solo para lo que no debe cortar el tope diario (ver `SpendCapScope`). */
  capScope: SpendCapScope = "day",
): Promise<void> {
  const { action } = RATE_LIMITS[bucket];
  const [spend, { allowed, retryAfterSeconds }] = await Promise.all([
    spendCapDecision(userId),
    consume(`user:${userId}`, bucket),
  ]);
  // El de gasto primero: su espera es la más larga, y la que de verdad manda.
  if (spend && !spend.allowed && spendCapBlocks(spend, capScope))
    throw new RateLimitError(spend.retryAfterSeconds, action, spend.scope);
  if (!allowed) throw new RateLimitError(retryAfterSeconds, action);
}

/** SHA-256 en hexadecimal con Web Crypto, que es lo único que hay garantizado
 *  en el runtime de despliegue (el mismo motivo por el que las push usan
 *  @pushforge/builder). */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Cuota de algo que se pide sin sesión, contada por correo. Devuelve si pasa en
 * vez de lanzar: quien la usa (recuperar contraseña) responde siempre lo mismo
 * exista o no la cuenta, y un error distinto rompería esa promesa.
 *
 * El correo se guarda hasheado, así que la tabla no acumula direcciones en
 * claro ni dice quién tiene cuenta.
 */
export async function checkEmailRateLimit(
  email: string,
  bucket: RateLimitBucket,
): Promise<boolean> {
  const hashed = await sha256Hex(email.trim().toLowerCase());
  const { allowed } = await consume(`email:${hashed}`, bucket);
  return allowed;
}
