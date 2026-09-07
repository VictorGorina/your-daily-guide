/**
 * Traduce los errores de Supabase Auth a claves de i18n nuestras.
 *
 * Hasta ahora la pantalla de acceso hacía `toast.error(error.message)`: el texto
 * crudo de Supabase, en inglés y a veces sin relación con lo que la persona ve
 * ("Email not confirmed" cuando lo que hizo fue escribir su contraseña). Aquí se
 * traduce por **código**, no por el texto, porque el mensaje cambia entre
 * versiones de GoTrue y el código no.
 *
 * Módulo puro a propósito: lo usan la web y —copiado, que no es un monorepo— la
 * app nativa, así que no puede depender de i18next ni de nada del navegador.
 */

/** Código de error de Supabase Auth, cuando lo trae. */
function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

const BY_CODE: Record<string, string> = {
  email_not_confirmed: "auth.errEmailNotConfirmed",
  invalid_credentials: "auth.errInvalidCredentials",
  user_already_exists: "auth.errUserExists",
  email_exists: "auth.errUserExists",
  weak_password: "auth.errWeakPassword",
  email_address_invalid: "auth.errEmailInvalid",
  over_email_send_rate_limit: "auth.errEmailRateLimit",
  over_request_rate_limit: "auth.errRateLimit",
  signup_disabled: "auth.errSignupDisabled",
};

/**
 * Versiones antiguas de GoTrue no mandan `code`, solo el texto. Se mira como
 * segundo intento, nunca como el primero.
 */
const BY_MESSAGE: [RegExp, string][] = [
  [/email not confirmed/i, "auth.errEmailNotConfirmed"],
  [/invalid login credentials/i, "auth.errInvalidCredentials"],
  [/already registered|already exists/i, "auth.errUserExists"],
  [/password should be at least/i, "auth.errWeakPassword"],
  [/rate limit|too many requests/i, "auth.errRateLimit"],
];

/**
 * Clave de i18n con la que contarle a la persona qué ha pasado. Si el error no
 * es de ninguno de los que sabemos leer, devuelve `fallback` — mejor un "no
 * hemos podido entrar" en español que el texto de Supabase en inglés.
 */
export function authErrorKey(error: unknown, fallback: string): string {
  const byCode = BY_CODE[errorCode(error)];
  if (byCode) return byCode;

  const message = errorMessage(error);
  for (const [pattern, key] of BY_MESSAGE) {
    if (pattern.test(message)) return key;
  }
  return fallback;
}

/**
 * ¿Es el caso de "la cuenta existe pero nadie confirmó el correo"? Es el único
 * error con una salida dentro de la app —reenviar la confirmación—, así que la
 * pantalla de acceso lo pregunta aparte para enseñar ese botón.
 */
export function isEmailNotConfirmed(error: unknown): boolean {
  return authErrorKey(error, "") === "auth.errEmailNotConfirmed";
}

/**
 * Texto ya listo para enseñar. Un error puede venir de tres sitios:
 *
 *   - Supabase Auth → se traduce por código con `authErrorKey`.
 *   - Nuestro propio backend (`ValidationError` en la web, `ApiError` en el
 *     móvil) → su mensaje ya está escrito en el idioma de la app, se enseña tal
 *     cual.
 *   - Cualquier otra cosa (un fallo de red, una librería) → mensaje genérico.
 *     Su `message` NO se enseña: es justo el inglés crudo del que se venía.
 */
const OWN_ERRORS = new Set(["ValidationError", "ApiError", "RateLimitError"]);

export function authErrorText(
  error: unknown,
  translate: (key: string) => string,
  fallbackKey: string,
): string {
  const key = authErrorKey(error, "");
  if (key) return translate(key);
  if (error instanceof Error && OWN_ERRORS.has(error.name) && error.message) {
    return error.message;
  }
  return translate(fallbackKey);
}
