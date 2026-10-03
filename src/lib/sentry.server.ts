import { afterResponse } from "@/lib/after-response.server";
import { scrubSentryEvent, type SentryEventLike } from "@/lib/sentry-scrub";

/**
 * Errores del servidor a Sentry (ticket 35 de la auditoría, región UE).
 *
 * No usa `@sentry/node`: arrastra OpenTelemetry y un árbol de dependencias que
 * Nitro tiene que empaquetar para Vercel, y este proyecto ya tuvo que dejar
 * `web-push` porque no funcionaba en el runtime de despliegue. Aquí basta el
 * protocolo "envelope" documentado de Sentry: un `fetch` con el evento en JSON.
 * Funciona en cualquier runtime y la limpieza (`scrubSentryEvent`) es nuestra.
 *
 * Sin `SENTRY_DSN` no hace nada (desarrollo, tests, o para apagarlo al
 * instante). Nunca lanza: un fallo al avisar no puede tumbar la petición.
 */

export type SentryDsn = { key: string; envelopeUrl: string };

/** `https://<clave>@<host>/<proyecto>` → dónde y con qué clave se manda. */
export function parseDsn(dsn: string | undefined): SentryDsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.username || !project) return null;
    return {
      key: url.username,
      envelopeUrl: `${url.protocol}//${url.host}/api/${project}/envelope/`,
    };
  } catch {
    return null;
  }
}

type Frame = { function?: string; filename?: string; lineno?: number; colno?: number };

/** Traza de V8 → frames de Sentry (del más antiguo al más reciente). */
export function stackFrames(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    frames.push({
      ...(m[1] ? { function: m[1] } : {}),
      filename: m[2],
      lineno: Number(m[3]),
      colno: Number(m[4]),
    });
  }
  return frames.reverse();
}

/** El cuerpo de la petición: cabecera, cabecera del item y evento, uno por línea. */
export function buildEnvelope(event: SentryEventLike & { event_id: string }): string {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

function baseEvent(level: "error" | "warning" | "info"): SentryEventLike & { event_id: string } {
  return {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "node",
    level,
    logger: "server",
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    environment: process.env.VERCEL_ENV ?? "development",
  };
}

function send(event: SentryEventLike & { event_id: string }): void {
  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  const request = fetch(dsn.envelopeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-sentry-envelope",
      "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=peppers-server/1.0`,
    },
    body: buildEnvelope(scrubSentryEvent(event)),
    signal: AbortSignal.timeout(3_000),
  })
    .then(() => undefined)
    .catch((error) => console.warn("sentry: no se pudo enviar", String(error)));
  // Con la petición en curso, que la función no se congele antes de enviarlo.
  // Sin puente (local, tests) la promesa sigue igualmente.
  afterResponse(request);
}

/** Un error inesperado (500) con su traza. */
export function captureServerException(
  error: unknown,
  context: { where?: string; userId?: string } = {},
): void {
  if (!process.env.SENTRY_DSN) return;
  const err = error instanceof Error ? error : new Error(String(error));
  send({
    ...baseEvent("error"),
    exception: {
      values: [
        { type: err.name, value: err.message, stacktrace: { frames: stackFrames(err.stack) } },
      ],
    },
    ...(context.where ? { tags: { where: context.where } } : {}),
    ...(context.userId ? { user: { id: context.userId } } : {}),
  });
}

/** Un evento de `logEvent` que merece aviso (ver `SENTRY_EVENTS` en `log.server.ts`). */
export function captureServerEvent(
  level: "error" | "warn",
  event: string,
  fields: Record<string, unknown>,
): void {
  if (!process.env.SENTRY_DSN) return;
  const userId = typeof fields.userId === "string" ? fields.userId : undefined;
  send({
    ...baseEvent(level === "warn" ? "warning" : "error"),
    message: event,
    tags: { event },
    extra: fields,
    ...(userId ? { user: { id: userId } } : {}),
  });
}
