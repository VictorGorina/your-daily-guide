import { redactFields } from "./log-redact";

/**
 * Limpieza de un evento antes de mandarlo a Sentry (ticket 35 de la auditoría).
 * Puro: lo usan el `beforeSend` del navegador y el emisor del servidor
 * (`sentry.server.ts`), y lo prueban los tests.
 *
 * La app guarda datos de salud; Sentry es un encargado de tratamiento más. Lo
 * que sale de aquí no lleva correos, tokens, cookies, cabeceras de sesión,
 * query strings ni ninguna de las claves de `REDACTED_KEYS` (notas, platos,
 * medicación…). De la persona queda solo su id (seudónimo), que hace falta
 * para investigar.
 */

type Breadcrumb = { message?: string; data?: Record<string, unknown> } & Record<string, unknown>;

export type SentryEventLike = {
  message?: string;
  exception?: { values?: ({ value?: string } & Record<string, unknown>)[] };
  user?: Record<string, unknown>;
  request?: {
    url?: string;
    headers?: Record<string, unknown>;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
  } & Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: Breadcrumb[];
} & Record<string, unknown>;

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

/** Un texto libre (mensaje de error, breadcrumb) sin correos. */
const scrubText = (text: string) => text.replace(EMAIL, "[email]");

/** Una URL sin query string ni fragmento (llevan códigos, tokens y filtros). */
const scrubUrl = (url: string) => url.split(/[?#]/)[0]!;

const scrubRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? redactFields(value as Record<string, unknown>)
    : undefined;

export function scrubSentryEvent<E extends SentryEventLike>(event: E): E {
  const out: SentryEventLike = { ...event };
  if (typeof out.message === "string") out.message = scrubText(out.message);
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) =>
        typeof v.value === "string" ? { ...v, value: scrubText(v.value) } : v,
      ),
    };
  }
  if (out.user) {
    const id = out.user.id;
    out.user = id != null ? { id } : undefined;
    if (!out.user) delete out.user;
  }
  if (out.request) {
    const { cookies: _cookies, query_string: _query, headers, data, url, ...rest } = out.request;
    const safeHeaders = headers
      ? Object.fromEntries(
          Object.entries(headers).filter(
            ([k]) => !/^(authorization|cookie|x-cron-secret)$/i.test(k),
          ),
        )
      : undefined;
    out.request = {
      ...rest,
      ...(url ? { url: scrubUrl(url) } : {}),
      ...(safeHeaders ? { headers: safeHeaders } : {}),
      ...(data !== undefined ? { data: scrubRecord(data) ?? "[redacted]" } : {}),
    };
  }
  if (out.extra) out.extra = redactFields(out.extra);
  if (out.contexts) out.contexts = redactContexts(out.contexts);
  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs.map((b) => {
      const crumb: Breadcrumb = { ...b };
      if (typeof crumb.message === "string") crumb.message = scrubText(crumb.message);
      if (crumb.data) {
        const data = redactFields(crumb.data);
        if (typeof data.url === "string") data.url = scrubUrl(data.url);
        crumb.data = data;
      }
      return crumb;
    });
  }
  return out as E;
}

/**
 * Los contextos que pone el propio SDK (navegador, sistema, runtime) se quedan;
 * cualquier otro pasa por `redactFields`.
 */
const SDK_CONTEXTS = new Set(["browser", "os", "device", "runtime", "app", "culture", "trace"]);
function redactContexts(contexts: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(contexts).map(([k, v]) => [k, SDK_CONTEXTS.has(k) ? v : scrubRecord(v)]),
  );
}
