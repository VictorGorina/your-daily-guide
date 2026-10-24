/**
 * Caducidad del código de invitación de un hogar (ticket 37 de la auditoría,
 * SEC-DB-14). El código lo genera y lo cambia el servidor (`create_household`,
 * `rotate_invite_code`); a los `INVITE_CODE_TTL_DAYS` días deja de valer para
 * unirse (`household_open_slots`, `claim_household_slot`). Esto solo decide qué
 * enseñar en Familia: la frontera de verdad está en SQL.
 *
 * Copia de `src/lib/household-invite.ts` (web), donde vive el test. Igual en
 * todo lo que no es comentario: lo vigila `check-shared-drift.sh`.
 */

/** El mismo plazo que el `interval '30 days'` de las funciones de unión. */
export const INVITE_CODE_TTL_DAYS = 30;

const DAY_MS = 86_400_000;

/** Cuándo deja de valer el código, o `null` si la fila no lo dice. */
export function inviteCodeExpiresAt(createdAt: string | null | undefined): Date | null {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(created) ? new Date(created + INVITE_CODE_TTL_DAYS * DAY_MS) : null;
}

/** ¿Ya no vale para unirse? Sin fecha se da por vigente: decide el servidor. */
export function isInviteCodeExpired(createdAt: string | null | undefined, now: Date): boolean {
  const expires = inviteCodeExpiresAt(createdAt);
  return expires !== null && expires.getTime() <= now.getTime();
}
