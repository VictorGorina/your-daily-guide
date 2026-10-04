/**
 * Lo que comparten el navegador y el servidor del CAPTCHA de Turnstile
 * (ticket 29). Puro: la comprobación con la clave secreta vive en
 * `turnstile.server.ts`.
 */

/** Un token real ronda los 500-2000 caracteres; el tope evita cuerpos enormes. */
export const MAX_CAPTCHA_TOKEN = 4_096;

/** El token tal como se acepta en un validador: texto corto o nada. */
export function cleanCaptchaToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const token = raw.trim();
  return token && token.length <= MAX_CAPTCHA_TOKEN ? token : undefined;
}
