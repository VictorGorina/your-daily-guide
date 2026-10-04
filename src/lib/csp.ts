/**
 * Content-Security-Policy y Permissions-Policy de la web (ticket 16 de la
 * auditoría, SEC-S-12). Por ahora la CSP va en modo Report-Only: el navegador
 * no bloquea nada, solo avisa a `/api/csp-report`, y con lo que llegue se
 * afina antes de aplicarla de verdad (ticket 37, que quitará también
 * `'unsafe-inline'` de los scripts con nonces).
 *
 * Puro: los orígenes llegan como argumento para poder probarlo sin entorno.
 */

type CspSources = {
  /** URL del proyecto de Supabase: REST y Auth por https, Realtime por wss. */
  supabaseUrl?: string;
  /** DSN de Sentry del navegador; solo cuenta su origen (el ingest). */
  sentryDsn?: string;
  /** Hay CAPTCHA de Turnstile: su script y su iframe son de Cloudflare. */
  turnstile?: boolean;
  /** `bun run dev`: el HMR de Vite abre un websocket a localhost. */
  dev?: boolean;
};

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

export function buildCsp({ supabaseUrl, sentryDsn, turnstile, dev }: CspSources): string {
  const connect = ["'self'"];
  const supabase = originOf(supabaseUrl);
  if (supabase) connect.push(supabase, supabase.replace(/^http/, "ws"));
  const sentry = originOf(sentryDsn);
  if (sentry) connect.push(sentry);
  if (dev) connect.push("ws://localhost:*");
  const cloudflare = turnstile ? ` ${TURNSTILE_ORIGIN}` : "";

  return [
    "default-src 'self'",
    // El SSR de TanStack inyecta scripts en línea (estado del router); se
    // cambia por nonces en el ticket 37.
    `script-src 'self' 'unsafe-inline'${cloudflare}`,
    "style-src 'self' 'unsafe-inline'",
    // Tipografías servidas desde el propio dominio desde el ticket 17.
    "font-src 'self'",
    // `data:`/`blob:`: la vista previa de la foto del tiquet.
    "img-src 'self' data: blob:",
    `connect-src ${connect.join(" ")}`,
    // El reto de Turnstile se pinta en un iframe de Cloudflare (ticket 29).
    ...(turnstile ? [`frame-src ${TURNSTILE_ORIGIN}`] : []),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "report-uri /api/csp-report",
  ].join("; ");
}

/**
 * Micrófono para el dictado por voz y cámara para la foto del tiquet
 * (`capture="environment"` en Plan), los dos solo en el propio origen.
 */
export const PERMISSIONS_POLICY = "camera=(self), geolocation=(), microphone=(self), payment=()";

export type CspViolation = {
  directive: string;
  blocked?: string;
  page?: string;
};

/**
 * URL sin query ni fragmento: pueden llevar un código de acceso o un token
 * (el enlace de recuperación de contraseña, por ejemplo). Las palabras clave
 * de CSP (`inline`, `eval`) no son URLs y se dejan tal cual.
 */
export function withoutQuery(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.slice(0, cut);
}

const MAX_REPORTS_PER_REQUEST = 20;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function violation(
  directive: unknown,
  fallbackDirective: unknown,
  blocked: unknown,
  page: unknown,
): CspViolation | null {
  const name =
    (typeof directive === "string" && directive) ||
    (typeof fallbackDirective === "string" && fallbackDirective.split(" ")[0]) ||
    "";
  if (!name) return null;
  return { directive: name, blocked: withoutQuery(blocked), page: withoutQuery(page) };
}

/**
 * Informes de un `POST` a `/api/csp-report`, en cualquiera de los dos
 * formatos: el de `report-uri` (`{"csp-report": {…}}`, Safari y Firefox) y el
 * de la Reporting API (una lista de `{type: "csp-violation", body}`, Chrome
 * cuando decide usarla). Lo que no encaja se descarta sin error.
 */
export function parseCspReport(raw: unknown): CspViolation[] {
  const out: CspViolation[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw.slice(0, MAX_REPORTS_PER_REQUEST)) {
      const record = asRecord(entry);
      const body = asRecord(record?.body);
      if (record?.type !== "csp-violation" || !body) continue;
      const v = violation(
        body.effectiveDirective,
        body.violatedDirective,
        body.blockedURL,
        body.documentURL,
      );
      if (v) out.push(v);
    }
    return out;
  }
  const report = asRecord(asRecord(raw)?.["csp-report"]);
  if (!report) return out;
  const v = violation(
    report["effective-directive"],
    report["violated-directive"],
    report["blocked-uri"],
    report["document-uri"],
  );
  if (v) out.push(v);
  return out;
}

const THROTTLE_WINDOW_MS = 60_000;

/**
 * Un log por `directiva + blocked` y minuto en cada instancia, para que una
 * página en bucle (o alguien mandando informes a mano) no llene los logs. El
 * mapa tiene tope: lleno y sin nada caducado que barrer, deja de registrar
 * hasta que haya hueco.
 */
export class CspReportThrottle {
  private readonly seen = new Map<string, number>();

  constructor(private readonly maxKeys = 500) {}

  get size(): number {
    return this.seen.size;
  }

  shouldLog(report: CspViolation, now: number): boolean {
    const key = `${report.directive} ${report.blocked ?? ""}`;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < THROTTLE_WINDOW_MS) return false;
    if (last === undefined && this.seen.size >= this.maxKeys) {
      for (const [k, t] of this.seen) {
        if (now - t >= THROTTLE_WINDOW_MS) this.seen.delete(k);
      }
      if (this.seen.size >= this.maxKeys) return false;
    }
    this.seen.set(key, now);
    return true;
  }
}
