import type { TablesUpdate } from "@/integrations/supabase/types";
import type { DailyGuide } from "@/lib/daily";
import { addDaysISO } from "@/lib/dates";
import { errorText, logEvent } from "@/lib/log.server";
import { daysLeftInMonth, nextMonthISO, NEXT_MONTH_UNLOCK_DAYS } from "@/lib/plan-shared";
import { sendPushNotification, type PushPayload } from "@/lib/web-push.server";
import { DEFAULT_TZ, zonedMinutesNow, zonedTodayISO } from "@/lib/zoned-date";

export type DispatchSummary = {
  sent: number;
  gone: number;
  // El servicio de push rechazó el envío (no 404/410): ver `push_failed` en el log.
  failed: number;
  skippedNoSubscription: number;
  // Tono "relajado" con el día ya completo: un push más sería ruido, así que
  // se contacta menos en vez de más. Ver propagación del tono en AGENTS.md.
  skippedLowNeed: number;
  errors: number;
};

// Ventana de 30 min hacia atrás. El cron corre cada 5 minutos (`pg_cron`, ya no
// el schedule de GitHub Actions, que aplazaba y descartaba ejecuciones: ticket
// 07), así que 30 minutos absorben hasta 5 ejecuciones perdidas seguidas sin
// llegar a mandar el aviso de la mañana a media tarde.
const WINDOW_MINUTES = 30;

// "Ahora" y "hoy" son por perfil: cada uno tiene su `timezone` (detectada del
// dispositivo), así que el resumen matutino y el repaso nocturno se comparan
// contra el reloj de esa persona, no contra el de Madrid. `zonedMinutesNow` y
// `zonedTodayISO` viven en zoned-date.ts.
//
// `profiles.timezone` se puede escribir con cualquier texto, e `Intl` lanza
// `RangeError` con una zona que no existe: sin el `catch`, un solo perfil así
// dejaba sin push a todos (ticket 06, SEC-DB-06). Se usa el reloj de Madrid.
function clockFor(timeZone: string | null): { nowMinutes: number; today: string } {
  const tz = timeZone || DEFAULT_TZ;
  try {
    return { nowMinutes: zonedMinutesNow(tz), today: zonedTodayISO(tz) };
  } catch {
    logEvent("warn", "push_bad_timezone", { timeZone: tz.slice(0, 64) });
    return { nowMinutes: zonedMinutesNow(DEFAULT_TZ), today: zonedTodayISO(DEFAULT_TZ) };
  }
}

// Los `.in("user_id", …)` van troceados: con todos los ids de golpe, la URL
// de PostgREST crece con cada perfil y acaba pasando del límite del servidor.
const ID_CHUNK = 100;

type QueryResult = PromiseLike<{ data: unknown; error: unknown }>;

async function selectByUserIds<T>(
  ids: string[],
  query: (chunk: string[]) => QueryResult,
): Promise<{ rows: T[]; error: unknown }> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  const results = await Promise.all(chunks.map(query));
  const failed = results.find((r) => r.error);
  if (failed) return { rows: [], error: failed.error };
  return { rows: results.flatMap((r) => (r.data ?? []) as T[]), error: null };
}

function timeToMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// A cuántos días o menos de fin de mes se avisa de que hay que preparar el plan
// del siguiente. Es el mismo umbral con el que el navegador de la pantalla Plan
// desbloquea el mes que viene (`plan-shared.ts`), para que aviso y desbloqueo
// coincidan.
const RENEWAL_DAYS_LEFT = NEXT_MONTH_UNLOCK_DAYS;

/** ¿`target` cae en (ahora - WINDOW_MINUTES, ahora]? Contempla el cruce de medianoche. */
export function inWindow(target: number | null, nowMinutes: number): boolean {
  if (target == null) return false;
  const windowStart = (nowMinutes - WINDOW_MINUTES + 1440) % 1440;
  if (windowStart < nowMinutes) return target > windowStart && target <= nowMinutes;
  return target > windowStart || target <= nowMinutes;
}

/**
 * El día al que pertenece un aviso que cae en la ventana. Si la hora objetivo
 * es mayor que la actual (aviso a las 23:50, ejecución a las 00:10), la ventana
 * cruzó la medianoche y el aviso es de AYER: marcarlo con la fecha nueva dejaba
 * sin aviso de noche el día que acaba de empezar.
 */
export function pushDayFor(target: number, nowMinutes: number, today: string): string {
  return target > nowMinutes ? addDaysISO(today, -1) : today;
}

/**
 * El día del aviso si `hhmm` cae en la ventana y aún no se envió para ese día;
 * `null` si no toca. Es la regla que `due_push_profiles` repite en SQL.
 */
export function dueDay(
  hhmm: string | null,
  sentOn: string | null,
  clock: { nowMinutes: number; today: string },
): string | null {
  const target = timeToMinutes(hhmm);
  if (target == null || !inWindow(target, clock.nowMinutes)) return null;
  const day = pushDayFor(target, clock.nowMinutes, clock.today);
  return sentOn === day ? null : day;
}

/** Una fila de `due_push_profiles`: a quién le toca qué aviso y de qué día. */
type DueRow = { id: string; kind: "morning" | "evening"; push_day: string };

type DayLogRow = { user_id: string; log_date: string; guide: unknown; habits: unknown };

const PROFILE_COLUMNS =
  "id, display_name, morning_time, evening_time, morning_push_sent_on, evening_push_sent_on, plan_renewal_push_sent_on, tone, timezone";

// PostgREST corta cada respuesta en 1.000 filas: sin paginar, a partir de ahí
// había perfiles que nunca recibían un aviso (PERF-03).
const PAGE_SIZE = 1000;
const CONCURRENCY = 25;

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

async function allOnboardedProfiles(supabaseAdmin: Admin): Promise<ProfileRow[]> {
  const all: ProfileRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("onboarding_completed", true)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as ProfileRow[];
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

type SentColumn = "morning_push_sent_on" | "evening_push_sent_on" | "plan_renewal_push_sent_on";

type ProfileRow = {
  id: string;
  display_name: string | null;
  morning_time: string;
  evening_time: string;
  morning_push_sent_on: string | null;
  evening_push_sent_on: string | null;
  plan_renewal_push_sent_on: string | null;
  tone: string | null;
  timezone: string | null;
};

type Tone = "relajado" | "neutro" | "exigente";
const toneOf = (tone: string | null): Tone =>
  tone === "relajado" || tone === "exigente" ? tone : "neutro";

type SubscriptionRow = { user_id: string; endpoint: string; p256dh: string; auth: string };

// Copys de mañana y noche adaptados al matiz elegido en el perfil (Ajustes),
// mismo espíritu que toneLine en ai-provider.server.ts pero para texto de
// notificación local en vez de prompt de IA.
function morningCopy(tone: Tone, name: string | null, mealIdea?: string) {
  const title = name ? `Buenos días, ${name}` : "Buenos días";
  if (tone === "relajado") {
    return {
      title,
      body: mealIdea
        ? `Sin prisa: hoy toca ${mealIdea}.`
        : "Tu guía de hoy está lista cuando quieras verla.",
    };
  }
  if (tone === "exigente") {
    return {
      title,
      body: mealIdea
        ? `Hoy toca: ${mealIdea}. Empieza el día con buen pie.`
        : "Tu guía de hoy ya está lista — no la dejes para luego.",
    };
  }
  return {
    title,
    body: mealIdea ? `Hoy toca: ${mealIdea}` : "Tu guía de hoy ya te está esperando.",
  };
}

function eveningCopy(tone: Tone, name: string | null, pendingCount: number) {
  const title = name ? `¿Cómo ha ido tu día, ${name}?` : "¿Cómo ha ido tu día?";
  if (tone === "relajado") {
    return { title, body: "Repásalo si te apetece, sin ninguna prisa." };
  }
  if (tone === "exigente") {
    const body =
      pendingCount > 0
        ? `Aún te ${pendingCount === 1 ? "queda" : "quedan"} ${pendingCount} comida${
            pendingCount === 1 ? "" : "s"
          } por registrar hoy.`
        : "Cierra el día repasándolo en menos de un minuto.";
    return { title, body };
  }
  return { title, body: "Repásalo en menos de un minuto." };
}

// Aviso de que quedan pocos días de mes y todavía no hay plan del siguiente.
// Lleva a Plan del mes que viene, donde la conversación con el coach (cinco
// preguntas, `MonthIntakeChat`) va antes de generarlo. Nada se genera solo: un
// mes se genera una vez y tras esa conversación.
function renewalCopy(tone: Tone, name: string | null, nextMonthLabel: string) {
  const title = name
    ? `${name}, es hora de preparar tu plan de ${nextMonthLabel}`
    : `Es hora de preparar tu plan de ${nextMonthLabel}`;
  if (tone === "relajado") {
    return { title, body: "Cuando quieras: cinco preguntas sobre tu mes y te lo preparo." };
  }
  if (tone === "exigente") {
    return {
      title,
      body: "Quedan pocos días: responde cinco preguntas y ten la compra lista antes de que empiece.",
    };
  }
  return { title, body: "Cuéntame en cinco preguntas cómo será tu mes y te lo preparo." };
}

// Variante para un miembro del hogar que NO planifica (D1): el menú y la compra
// de las comidas compartidas los renueva el planificador, no esta persona; a
// ella solo le toca planificar sus comidas en solitario. Sin variar por tono:
// el aviso es informativo, no una llamada a la acción.
function renewalCopyMember(name: string | null, nextMonthLabel: string) {
  const title = name
    ? `${name}, es hora de preparar tus comidas de ${nextMonthLabel}`
    : `Es hora de preparar tus comidas de ${nextMonthLabel}`;
  return {
    title,
    body: "El menú de tu casa lo renueva quien planifica. Tú prepara tus comidas en solitario: son cinco preguntas.",
  };
}

/**
 * Recorre los perfiles cuyo `morning_time`/`evening_time` cae en la ventana
 * actual y no se les ha enviado ya hoy, y envía el push correspondiente a
 * cada una de sus suscripciones. Pensado para llamarse desde
 * `POST /api/cron/dispatch`, disparado externamente (`pg_cron`) cada 5
 * minutos — ver "Push notifications" en AGENTS.md.
 */
export async function dispatchPush(
  /** Solo para los tests: el envío real por defecto. */
  deps: { send?: typeof sendPushNotification } = {},
): Promise<DispatchSummary> {
  const send = deps.send ?? sendPushNotification;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const summary: DispatchSummary = {
    sent: 0,
    gone: 0,
    failed: 0,
    skippedNoSubscription: 0,
    skippedLowNeed: 0,
    errors: 0,
  };

  // Quién tiene un aviso de mañana o de noche en su ventana lo calcula la base
  // de datos (`due_push_profiles`, ticket 23): la mayoría de los disparos no
  // tienen a nadie y así no se leen todos los perfiles cada 5 minutos. Si la
  // función falla o aún no existe, se recorre la tabla aquí con la misma regla.
  const { data: dueData, error: dueError } = await supabaseAdmin.rpc("due_push_profiles", {
    _window_minutes: WINDOW_MINUTES,
  });
  const dueRows = dueError ? null : ((dueData ?? []) as unknown as DueRow[]);
  if (dueError) logEvent("warn", "push_due_rpc_failed", { error: errorText(dueError) });

  // El aviso de renovación sí necesita todos los perfiles, pero solo la última
  // semana del mes. Entre UTC−12 y UTC+14 la fecha local es la de UTC, la de
  // ayer o la de mañana: si en ninguna quedan pocos días, no hay a quién avisar.
  const utcToday = new Date().toISOString().slice(0, 10);
  const renewalPossible = [-1, 0, 1].some(
    (offset) => daysLeftInMonth(addDaysISO(utcToday, offset)) <= RENEWAL_DAYS_LEFT,
  );

  let rows: ProfileRow[];
  if (dueRows === null || renewalPossible) {
    rows = await allOnboardedProfiles(supabaseAdmin);
  } else {
    const dueIds = [...new Set(dueRows.map((d) => d.id))];
    if (!dueIds.length) return summary;
    const { rows: found, error } = await selectByUserIds<ProfileRow>(dueIds, (ids) =>
      supabaseAdmin.from("profiles").select(PROFILE_COLUMNS).in("id", ids),
    );
    if (error) throw error;
    rows = found;
  }

  // Un reloj por perfil, cada uno en su zona horaria. Todo lo que sigue ("¿cae
  // en la ventana?", "¿ya se avisó hoy?", "¿quedan pocos días de mes?") se
  // evalúa contra el reloj de esa persona.
  const clocks = new Map(rows.map((p) => [p.id, clockFor(p.timezone)]));
  const clockOf = (p: ProfileRow) => clocks.get(p.id) ?? clockFor(p.timezone);
  const nextMonthOf = (p: ProfileRow) => nextMonthISO(clockOf(p).today);

  // Perfiles con la hora en la ventana y sin aviso todavía para SU día (el de
  // ayer si la ventana cruzó la medianoche, `pushDayFor`).
  type Due = { profile: ProfileRow; day: string };
  const byId = new Map(rows.map((p) => [p.id, p]));
  const selectDue = (kind: "morning" | "evening"): Due[] => {
    if (dueRows) {
      return dueRows.flatMap((d) => {
        const p = d.kind === kind ? byId.get(d.id) : undefined;
        return p ? [{ profile: p, day: d.push_day }] : [];
      });
    }
    return rows.flatMap((p) => {
      const day = dueDay(p[`${kind}_time`], p[`${kind}_push_sent_on`], clockOf(p));
      return day ? [{ profile: p, day }] : [];
    });
  };
  const morningMatches = selectDue("morning");
  const eveningMatches = selectDue("evening");

  // A `RENEWAL_DAYS_LEFT` días o menos de fin de mes, si todavía no hay plan del
  // mes siguiente (y no se avisó ya hoy), se avisa una vez al día hasta que lo
  // generen desde Plan (donde ese mismo umbral desbloquea el mes que viene y la
  // barra de abajo marca la pestaña con un punto).
  const renewalCandidates = !renewalPossible
    ? []
    : rows.filter((p) => {
        const { today } = clockOf(p);
        return daysLeftInMonth(today) <= RENEWAL_DAYS_LEFT && p.plan_renewal_push_sent_on !== today;
      });
  let renewalMatches: ProfileRow[] = [];
  if (renewalCandidates.length) {
    const nextMonths = [...new Set(renewalCandidates.map(nextMonthOf))];
    const { rows: nextPlans, error: plansError } = await selectByUserIds<{
      user_id: string;
      month: string;
    }>(
      renewalCandidates.map((p) => p.id),
      (ids) =>
        supabaseAdmin
          .from("monthly_plans")
          .select("user_id, month")
          .in("month", nextMonths)
          .in("user_id", ids),
    );
    if (plansError) {
      // Sin saber quién tiene ya el plan, el aviso le llegaría también a quien
      // lo tiene: esta vez no se avisa a nadie (ni se marca) y lo intenta el
      // siguiente disparo.
      summary.errors++;
      logEvent("error", "push_query_failed", {
        query: "next_plans",
        error: errorText(plansError),
      });
    } else {
      const alreadyPlanned = new Set(nextPlans.map((row) => `${row.user_id}|${row.month}`));
      renewalMatches = renewalCandidates.filter(
        (p) => !alreadyPlanned.has(`${p.id}|${nextMonthOf(p)}`),
      );
    }
  }

  if (!morningMatches.length && !eveningMatches.length && !renewalMatches.length) return summary;

  const matchedIds = [
    ...new Set(
      [...morningMatches.map((d) => d.profile), ...eveningMatches.map((d) => d.profile)]
        .concat(renewalMatches)
        .map((p) => p.id),
    ),
  ];
  const { rows: subs, error: subsError } = await selectByUserIds<SubscriptionRow>(
    matchedIds,
    (ids) =>
      supabaseAdmin
        .from("push_subscriptions")
        .select("user_id, endpoint, p256dh, auth")
        .in("user_id", ids),
  );
  if (subsError) {
    // Sin suscripciones no se envía nada; tampoco se marca, para que el
    // siguiente disparo (dentro de la ventana) lo vuelva a intentar.
    summary.errors++;
    logEvent("error", "push_query_failed", {
      query: "subscriptions",
      error: errorText(subsError),
    });
    return summary;
  }

  const subsByUser = new Map<string, SubscriptionRow[]>();
  for (const s of subs) {
    const list = subsByUser.get(s.user_id) ?? [];
    list.push(s);
    subsByUser.set(s.user_id, list);
  }

  // Hasta `CONCURRENCY` a la vez, sin esperar a que acabe un lote entero: un
  // envío lento ya no frena a los nueve que iban con él. JS es single-threaded,
  // así que las mutaciones a `summary` entre awaits no hacen race conditions.
  async function batch<T>(items: T[], fn: (item: T) => Promise<void>) {
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++] as T;
        await fn(item).catch((err) => {
          summary.errors++;
          logEvent("error", "push_send_threw", { error: errorText(err) });
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  }

  const sendTo = async (userId: string, payload: PushPayload) => {
    const userSubs = subsByUser.get(userId) ?? [];
    if (!userSubs.length) {
      summary.skippedNoSubscription++;
      return;
    }
    await Promise.allSettled(
      userSubs.map(async (s) => {
        try {
          const result = await send(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          if (result === "gone") {
            summary.gone++;
            await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          } else if (result === "failed") {
            summary.failed++;
          } else {
            summary.sent++;
          }
        } catch (err) {
          summary.errors++;
          logEvent("error", "push_send_threw", { userId, error: errorText(err) });
        }
      }),
    );
  };

  // Marca atómica: se RECLAMA el aviso antes de enviarlo. El UPDATE solo toca la
  // fila si todavía no lleva ese día, así que de dos ejecuciones solapadas solo
  // una se la lleva y envía (antes se marcaba después de enviar y salían dos).
  // Si el envío falla después de reclamar, ese aviso no se reintenta ese día.
  const claim = async (column: SentColumn, id: string, day: string): Promise<boolean> => {
    const mark: TablesUpdate<"profiles"> = {};
    mark[column] = day;
    const { data, error: claimError } = await supabaseAdmin
      .from("profiles")
      .update(mark)
      .eq("id", id)
      .or(`${column}.is.null,${column}.neq.${day}`)
      .select("id");
    if (claimError) {
      summary.errors++;
      logEvent("error", "push_claim_failed", { column, error: errorText(claimError) });
      return false;
    }
    return !!data?.length;
  };

  // El día de cada aviso, en bloque: una consulta por cada 100 perfiles en vez
  // de una por perfil. Trae también el día de al lado de alguien de otra zona;
  // se queda el `push_day` de cada uno en memoria.
  const dayMatches = [...morningMatches, ...eveningMatches];
  const logs = new Map<string, DayLogRow>();
  if (dayMatches.length) {
    const days = [...new Set(dayMatches.map((d) => d.day))];
    const { rows: logRows, error: logsError } = await selectByUserIds<DayLogRow>(
      [...new Set(dayMatches.map((d) => d.profile.id))],
      (ids) =>
        supabaseAdmin
          .from("daily_logs")
          .select("user_id, log_date, guide, habits")
          .in("log_date", days)
          .in("user_id", ids),
    );
    if (logsError) {
      // Sin el día no se sabe qué decir: nadie recibe el aviso de mañana ni el
      // de noche, ni se marca, y el siguiente disparo lo vuelve a intentar.
      summary.errors++;
      logEvent("error", "push_query_failed", { query: "daily_log", error: errorText(logsError) });
    } else {
      for (const row of logRows) logs.set(`${row.user_id}|${row.log_date}`, row);

      await batch(morningMatches, async ({ profile: p, day }) => {
        // Se reclama tanto si hay suscripciones como si no, para no reintentar en
        // bucle dentro del mismo día — igual para la noche debajo.
        if (!(await claim("morning_push_sent_on", p.id, day))) return;
        const guide = logs.get(`${p.id}|${day}`)?.guide as DailyGuide | null | undefined;
        const { title, body } = morningCopy(
          toneOf(p.tone),
          p.display_name,
          guide?.meals?.[0]?.idea,
        );
        await sendTo(p.id, { title, body, url: "/hoy" });
      });

      await batch(eveningMatches, async ({ profile: p, day }) => {
        const tone = toneOf(p.tone);
        if (!(await claim("evening_push_sent_on", p.id, day))) return;
        const habits = (logs.get(`${p.id}|${day}`)?.habits as { done: boolean }[] | null) ?? [];
        const pendingCount = Math.max(0, habits.length - habits.filter((h) => h.done).length);
        // Tono relajado + día ya completo: se prioriza contactar menos, no un
        // push de más que no aporta nada. Los otros tonos siempre reciben el
        // repaso de la noche.
        const skip = tone === "relajado" && habits.length > 0 && pendingCount === 0;
        if (skip) {
          summary.skippedLowNeed++;
        } else {
          const { title, body } = eveningCopy(tone, p.display_name, pendingCount);
          await sendTo(p.id, { title, body, url: "/hoy" });
        }
      });
    }
  }

  if (renewalMatches.length) {
    // Un no planificador del hogar recibe un aviso distinto: la renovación del
    // menú de la casa no es cosa suya (issue 08, D1).
    const { rows: memberRows, error: membersError } = await selectByUserIds<{
      user_id: string | null;
      is_planner: boolean;
    }>(
      renewalMatches.map((p) => p.id),
      (ids) =>
        supabaseAdmin.from("household_members").select("user_id, is_planner").in("user_id", ids),
    );
    if (membersError) {
      // Sin saber quién planifica, un no planificador recibiría el aviso del
      // planificador: esta vez no se avisa (ni se marca).
      summary.errors++;
      logEvent("error", "push_query_failed", {
        query: "household_members",
        error: errorText(membersError),
      });
      return summary;
    }
    const nonPlanner = new Set(
      memberRows.filter((m) => m.user_id && !m.is_planner).map((m) => m.user_id as string),
    );
    await batch(renewalMatches, async (p) => {
      const { today } = clockOf(p);
      if (!(await claim("plan_renewal_push_sent_on", p.id, today))) return;
      const nextMonth = nextMonthOf(p);
      const nextMonthLabel = new Date(`${nextMonth}-01T00:00:00`).toLocaleDateString("es-ES", {
        month: "long",
      });
      const { title, body } = nonPlanner.has(p.id)
        ? renewalCopyMember(p.display_name, nextMonthLabel)
        : renewalCopy(toneOf(p.tone), p.display_name, nextMonthLabel);
      // Lleva directo a la pantalla del plan del mes que viene (ya desbloqueada),
      // no a Hoy: el objetivo del aviso es que preparen ese plan y su compra.
      await sendTo(p.id, { title, body, url: `/plan?month=${nextMonth}` });
    });
  }

  return summary;
}
