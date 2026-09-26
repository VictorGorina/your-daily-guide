/**
 * ¿La cabecera `x-cron-secret` coincide con `CRON_SECRET`? Compara en tiempo
 * constante los SHA-256 de los dos lados (misma longitud siempre), para que el
 * tiempo de respuesta no delate cuántos caracteres acierta un intento. Sin
 * `CRON_SECRET` definido, nunca coincide.
 *
 * Web Crypto y no `node:crypto`, como `sha256Hex` en `rate-limit.server.ts`.
 */
export async function cronSecretMatches(given: string | null): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !given) return false;
  const digest = async (v: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  const [a, b] = await Promise.all([digest(given), digest(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
