import { logEvent } from "@/lib/log.server";

export const MIN_CRON_SECRET_LENGTH = 32;

/**
 * ¿La cabecera `x-cron-secret` coincide con `CRON_SECRET`? Compara en tiempo
 * constante los SHA-256 de los dos lados (misma longitud siempre), para que el
 * tiempo de respuesta no delate cuántos caracteres acierta un intento. Sin
 * `CRON_SECRET` definido, o con uno de menos de 32 caracteres, nunca coincide.
 *
 * Web Crypto y no `node:crypto`, como `sha256Hex` en `rate-limit.server.ts`.
 */
export async function cronSecretMatches(given: string | null): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !given) return false;
  // Un secreto corto se adivina (ticket 06): mejor que el cron falle con un
  // 401 y un aviso en el log que dejarlo abierto. `openssl rand -hex 32`.
  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    logEvent("error", "cron_secret_weak", { length: secret.length });
    return false;
  }
  const digest = async (v: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  const [a, b] = await Promise.all([digest(given), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
