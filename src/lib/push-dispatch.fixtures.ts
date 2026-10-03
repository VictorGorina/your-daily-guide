/**
 * Perfiles de muestra para la regla "¿a quién le toca un aviso ahora?" (ticket
 * 23): 30 perfiles en seis zonas horarias, con lo que se espera de cada uno
 * escrito a mano. Sirven al test de `dueDay` y a la comparación manual con
 * `due_push_profiles_at` en el SQL Editor.
 *
 * El instante es 2026-10-04 10:10 UTC: 12:10 en Madrid, 11:10 en Canarias,
 * 04:10 en Ciudad de México, 07:10 en Buenos Aires, 00:10 del día 5 en
 * Kiritimati (UTC+14) y 23:10 del día 3 en Pago Pago (UTC−11).
 */
export const FIXTURE_NOW = new Date("2026-10-04T10:10:00Z");

export type PushFixtureProfile = {
  id: string;
  timezone: string | null;
  morning_time: string;
  evening_time: string;
  morning_push_sent_on: string | null;
  evening_push_sent_on: string | null;
  /** Lo esperado: `kind|día`. */
  due: string[];
};

const MADRID = "Europe/Madrid";
const CANARY = "Atlantic/Canary";
const MEXICO = "America/Mexico_City";
const BUENOS_AIRES = "America/Argentina/Buenos_Aires";
const KIRITIMATI = "Pacific/Kiritimati";
const PAGO_PAGO = "Pacific/Pago_Pago";

// Una hora lejos de cualquier ventana, para el aviso que no se está probando.
const FAR = "17:00";

const f = (
  id: string,
  timezone: string | null,
  morning_time: string,
  evening_time: string,
  sent: { morning?: string; evening?: string },
  due: string[],
): PushFixtureProfile => ({
  id,
  timezone,
  morning_time,
  evening_time,
  morning_push_sent_on: sent.morning ?? null,
  evening_push_sent_on: sent.evening ?? null,
  due,
});

export const PUSH_FIXTURE_PROFILES: PushFixtureProfile[] = [
  // Madrid, 12:10 del día 4.
  f("mad-01", MADRID, "12:10", FAR, {}, ["morning|2026-10-04"]),
  f("mad-02", MADRID, "11:41", FAR, {}, ["morning|2026-10-04"]),
  f("mad-03", MADRID, "11:40", FAR, {}, []),
  f("mad-04", MADRID, "12:11", FAR, {}, []),
  f("mad-05", MADRID, "12:00", FAR, { morning: "2026-10-04" }, []),
  f("mad-06", null, "12:00", FAR, { morning: "2026-10-03" }, ["morning|2026-10-04"]),
  f("mad-07", MADRID, "08:00", "12:05", {}, ["evening|2026-10-04"]),
  // Canarias, 11:10 del día 4.
  f("can-01", CANARY, "11:00", FAR, {}, ["morning|2026-10-04"]),
  f("can-02", CANARY, "12:10", FAR, {}, []),
  f("can-03", CANARY, "08:00", "10:45", {}, ["evening|2026-10-04"]),
  f("can-04", CANARY, "08:00", "10:40", {}, []),
  f("can-05", CANARY, "11:10", "11:10", {}, ["morning|2026-10-04", "evening|2026-10-04"]),
  // Ciudad de México, 04:10 del día 4.
  f("mex-01", MEXICO, "04:00", FAR, {}, ["morning|2026-10-04"]),
  f("mex-02", MEXICO, "12:00", FAR, {}, []),
  f("mex-03", MEXICO, "08:00", "03:50", { evening: "2026-10-04" }, []),
  f("mex-04", MEXICO, "08:00", "03:41", {}, ["evening|2026-10-04"]),
  f("mex-05", MEXICO, "03:40", FAR, {}, []),
  // Buenos Aires, 07:10 del día 4.
  f("bue-01", BUENOS_AIRES, "07:00", FAR, {}, ["morning|2026-10-04"]),
  f("bue-02", BUENOS_AIRES, "07:30", FAR, {}, []),
  f("bue-03", BUENOS_AIRES, "09:00", "06:55", {}, ["evening|2026-10-04"]),
  f("bue-04", BUENOS_AIRES, "07:05", "07:05", { morning: "2026-10-04" }, ["evening|2026-10-04"]),
  // Kiritimati, 00:10 del día 5: un aviso de las 23:50 es del día 4.
  f("kir-01", KIRITIMATI, "08:00", "23:50", {}, ["evening|2026-10-04"]),
  f("kir-02", KIRITIMATI, "08:00", "23:50", { evening: "2026-10-04" }, []),
  f("kir-03", KIRITIMATI, "08:00", "23:50", { evening: "2026-10-03" }, ["evening|2026-10-04"]),
  f("kir-04", KIRITIMATI, "00:05", FAR, {}, ["morning|2026-10-05"]),
  f("kir-05", KIRITIMATI, "08:00", "23:40", {}, []),
  f("kir-06", KIRITIMATI, "00:10", FAR, { morning: "2026-10-04" }, ["morning|2026-10-05"]),
  // Pago Pago, 23:10 del día 3.
  f("pag-01", PAGO_PAGO, "08:00", "23:00", {}, ["evening|2026-10-03"]),
  f("pag-02", PAGO_PAGO, "08:00", "23:00", { evening: "2026-10-03" }, []),
  f("pag-03", PAGO_PAGO, "23:10", "22:00", {}, ["morning|2026-10-03"]),
];

export const EXPECTED_DUE: string[] = PUSH_FIXTURE_PROFILES.flatMap((p) =>
  p.due.map((d) => `${p.id}|${d}`),
);
