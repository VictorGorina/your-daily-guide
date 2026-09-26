/**
 * Fecha de nacimiento como fecha LOCAL. `new Date("1996-06-16")` la lee como medianoche UTC,
 * que al oeste de Greenwich (México, UTC−6) es aún el día 15: el cumpleaños se contaba un día
 * antes. El texto ISO se lee por partes; cualquier otro formato sigue pasando por `Date`.
 */
function parseLocalDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

/** Edad en años cumplidos a fecha de hoy, a partir de una fecha de nacimiento ISO (YYYY-MM-DD). */
export function ageFromDOB(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = parseLocalDate(dob);
  if (Number.isNaN(d.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const beforeBirthday =
    today.getMonth() < d.getMonth() ||
    (today.getMonth() === d.getMonth() && today.getDate() < d.getDate());
  if (beforeBirthday) age--;

  return age >= 0 ? age : null;
}

/** Fecha de nacimiento ISO aproximada para una edad dada (usada en datos de demo). */
export function dobFromAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  // Fecha local, no `toISOString()` (UTC): por la noche en América daría ya mañana.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
