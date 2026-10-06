/**
 * Para quién es un enlace de confirmar o restablecer (ticket 38, MOB-01). El
 * enlace trae un `access_token`; antes de instalarlo como sesión se mira de
 * quién es. El JWT se decodifica SIN verificar la firma: solo sirve para
 * comparar con quien ya tiene la sesión abierta y preguntar. Quien decide si el
 * token vale es Supabase, al usarlo.
 */
export type LinkClaims = { sub: string; email: string | null };

/** Claims de un JWT, o `null` si no lo parece. */
export function jwtClaims(token: string | null | undefined): LinkClaims | null {
  const payload = (token ?? "").split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    // `atob` da un byte por carácter: se rehace el UTF-8 (un nombre con tilde).
    const bytes = atob(padded);
    const json = decodeURIComponent(
      Array.from(bytes, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
    );
    const claims: unknown = JSON.parse(json);
    if (!claims || typeof claims !== "object") return null;
    const { sub, email } = claims as { sub?: unknown; email?: unknown };
    if (typeof sub !== "string" || !sub) return null;
    return { sub, email: typeof email === "string" && email ? email : null };
  } catch {
    return null;
  }
}

/**
 * La cuenta del enlace cuando NO es la de la sesión abierta; `null` si no hay
 * sesión, si es la misma o si el token no se deja leer (entonces no se
 * pregunta: decide Supabase al instalarlo).
 */
export function linkForAnotherAccount(
  accessToken: string | null | undefined,
  currentUserId: string | null | undefined,
): LinkClaims | null {
  if (!currentUserId) return null;
  const claims = jwtClaims(accessToken);
  return claims && claims.sub !== currentUserId ? claims : null;
}
