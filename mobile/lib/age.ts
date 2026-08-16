/** Edad en años cumplidos a fecha de hoy, a partir de una fecha de nacimiento ISO (YYYY-MM-DD). */
export function ageFromDOB(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const beforeBirthday =
    today.getMonth() < d.getMonth() ||
    (today.getMonth() === d.getMonth() && today.getDate() < d.getDate());
  if (beforeBirthday) age--;

  return age >= 0 ? age : null;
}
