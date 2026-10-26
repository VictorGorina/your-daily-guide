/**
 * Lo que comparten la web y el móvil del CAPTCHA de Turnstile (ticket 29): los
 * topes de la espera y el mensaje que la página del reto (`CAPTCHA_PAGE_PATH`)
 * manda a la app del iPhone desde su WebView. Copia idéntica en
 * mobile/lib/captcha-bridge.ts (lo vigila scripts/check-shared-drift.sh).
 * Puro y sin imports.
 */

/**
 * Página que pinta el reto dentro del WebView del móvil. Cloudflare solo da
 * token en los dominios del widget (`www.peppersfam.es`, `localhost`): por eso
 * es una página de la web y no HTML metido en la app.
 */
export const CAPTCHA_PAGE_PATH = "/api/v1/auth/captcha";

/**
 * Hasta que Cloudflare da el token o pide la casilla, contando la carga del
 * script (en el móvil, también la de la página). Medido: pide la casilla a los
 * 3,4 s. Holgado a propósito: al vencer se retira el reto aunque estuviera a
 * punto de acabar, y con el CAPTCHA exigido (`TURNSTILE_ENFORCE`) una conexión
 * lenta que no llega nunca a tiempo no podría entrar. Con 10 s ese riesgo era
 * real.
 */
export const INVISIBLE_TIMEOUT_MS = 20_000;

/**
 * Con la casilla a la vista: tiempo para verla y marcarla. Se cuenta una vez
 * por intento (un reto que vuelve a salir no lo alarga). Pasado, se sigue sin
 * token; si el servidor lo exige, la persona ve el error y vuelve a probar.
 */
export const INTERACTIVE_TIMEOUT_MS = 30_000;

/** Lo que la página del reto cuenta a la app, uno por cada callback de Turnstile. */
export type CaptchaEvent =
  /** El servidor no tiene clave de sitio: no hay CAPTCHA que pasar. */
  | { type: "off" }
  | { type: "token"; token: string }
  /** Cloudflare pide la casilla: la app enseña el reto y el aviso. */
  | { type: "interactive" }
  | { type: "error"; code: string }
  | { type: "unsupported" }
  /** Cloudflare cerró un reto que nadie marcó. */
  | { type: "timeout" };

/** Un token real ronda los 500-2000 caracteres (como `MAX_CAPTCHA_TOKEN`). */
const MAX_TOKEN = 4_096;
const MAX_MESSAGE = 8_192;

/**
 * El mensaje de la página, o `null` si no es uno de los suyos. Llega por
 * `postMessage` como texto: no se da nada por bueno sin mirarlo.
 */
export function parseCaptchaMessage(raw: unknown): CaptchaEvent | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { type, token, code } = data as Record<string, unknown>;
  switch (type) {
    case "off":
    case "interactive":
    case "unsupported":
    case "timeout":
      return { type };
    case "token":
      return typeof token === "string" && token.length > 0 && token.length <= MAX_TOKEN
        ? { type, token }
        : null;
    case "error":
      return { type, code: typeof code === "string" ? code.slice(0, 32) : "" };
    default:
      return null;
  }
}
