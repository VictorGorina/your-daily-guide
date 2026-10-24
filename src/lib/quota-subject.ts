/**
 * De qué se cuelga la cuota de lo que se pide sin sesión (ticket 29 de la
 * auditoría): el alta y el restablecimiento de contraseña mandan un correo, y
 * con alias del mismo buzón (`ana+1@…`, `a.na@gmail.com`) cada dirección
 * estrenaba cuota. Puro, sin hash: el hash con sal va en `rate-limit.server.ts`.
 */

/** Dominios que entregan en el mismo buzón e ignoran los puntos del nombre. */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * El buzón al que llega un correo, para contar la cuota. Minúsculas y sin
 * `+etiqueta`; en Gmail, también sin puntos y con un solo dominio. SOLO para la
 * cuota: el correo se manda siempre a la dirección que escribió la persona.
 *
 * Juntar de más (un proveedor donde `+` sí cambia de buzón) solo hace que dos
 * direcciones compartan las 5 por hora; juntar de menos dejaba pasar el abuso.
 */
export function normalizeEmailForQuota(email: string): string {
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at <= 0) return clean;
  let local = clean.slice(0, at);
  let domain = clean.slice(at + 1);
  const plus = local.indexOf("+");
  // `+algo@…` sin nombre delante se deja tal cual: si no, todas esas
  // direcciones de un dominio contarían como una sola.
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    domain = "gmail.com";
    local = local.replaceAll(".", "") || local;
  }
  return `${local}@${domain}`;
}

/**
 * IP de quien hace la petición: el primer valor de `x-forwarded-for`. En Vercel
 * esa cabecera la pone el propio Vercel y descarta la que mande el cliente, así
 * que no se puede falsificar para estrenar cuota. `null` si no viene (en local,
 * o detrás de algo que no la pone): entonces solo cuenta la cuota por correo.
 */
export function clientIp(headers: Pick<Headers, "get">): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim().toLowerCase();
  return first ? first : null;
}
