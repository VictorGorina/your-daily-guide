import type { DailyGuide } from "@/lib/daily";
import { daysLeftInMonth, nextMonthISO, NEXT_MONTH_UNLOCK_DAYS } from "@/lib/plan-shared";
import { sendPushNotification, type PushPayload } from "@/lib/web-push.server";
import { DEFAULT_TZ, zonedMinutesNow, zonedTodayISO } from "@/lib/zoned-date";

export type DispatchSummary = {
  sent: number;
  gone: number;
  skippedNoSubscription: number;
  // Tono "relajado" con el día ya completo: un push más sería ruido, así que
  // se contacta menos en vez de más. Ver propagación del tono en AGENTS.md.
  skippedLowNeed: number;
  errors: number;
};

// Ventana de 20 min hacia atrás: algo más ancha que la cadencia del workflow
// de GitHub Actions (cada 15 min) para absorber el jitter típico de los
// schedules de Actions sin dejar ningún hueco sin cubrir.
const WINDOW_MINUTES = 20;

// "Ahora" y "hoy" son por perfil: cada uno tiene su `timezone` (detectada del
// dispositivo), así que el resumen matutino y el repaso nocturno se comparan
// contra el reloj de esa persona, no contra el de Madrid. `zonedMinutesNow` y
// `zonedTodayISO` viven en zoned-date.ts.
function clockFor(timeZone: string | null): { nowMinutes: number; today: string } {
  const tz = timeZone || DEFAULT_TZ;
  return { nowMinutes: zonedMinutesNow(tz), today: zonedTodayISO(tz) };
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
function inWindow(target: number | null, nowMinutes: number): boolean {
  if (target == null) return false;
  const windowStart = (nowMinutes - WINDOW_MINUTES + 1440) % 1440;
  if (windowStart < nowMinutes) return target > windowStart && target <= nowMinutes;
  return target > windowStart || target <= nowMinutes;
}

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
// Al abrir la app desde este push, la generación automática de la pantalla
// Hoy se encarga de crearlo en cuanto entre el nuevo mes.
function renewalCopy(tone: Tone, name: string | null, nextMonthLabel: string) {
  const title = name ? `${name}, se acaba el mes` : "Se acaba el mes";
  if (tone === "relajado") {
    return {
      title,
      body: `Cuando quieras, abre la app para preparar tu plan de ${nextMonthLabel}.`,
    };
  }
  if (tone === "exigente") {
    return {
      title,
      body: `Quedan pocos días: prepara ya tu plan de ${nextMonthLabel} y su lista de la compra.`,
    };
  }
  return {
    title,
    body: `Tu plan de ${nextMonthLabel} está al caer. Ábrelo y te lo preparo.`,
  };
}

// Variante para un miembro del hogar que NO planifica (D1): el menú y la compra
// de las comidas compartidas los renueva el planificador, no esta persona; a
// ella solo le toca planificar sus comidas en solitario. Sin variar por tono:
// el aviso es informativo, no una llamada a la acción.
function renewalCopyMember(name: string | null, nextMonthLabel: string) {
  const title = name ? `${name}, se acaba el mes` : "Se acaba el mes";
  return {
    title,
    body: `El menú de tu casa lo renueva quien planifica. Abre la app para preparar tus comidas en solitario de ${nextMonthLabel}.`,
  };
}

/**
 * Recorre los perfiles cuyo `morning_time`/`evening_time` cae en la ventana
 * actual y no se les ha enviado ya hoy, y envía el push correspondiente a
 * cada una de sus suscripciones. Pensado para llamarse desde
 * `POST /api/cron/dispatch`, disparado externamente (GitHub Actions) cada 15
 * minutos — ver AGENTS.md para por qué no usamos el `scheduled` nativo de
 * Cloudflare Workers.
 */
export async function dispatchPush(): Promise<DispatchSummary> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const summary: DispatchSummary = {
    sent: 0,
    gone: 0,
    skippedNoSubscription: 0,
    skippedLowNeed: 0,
    errors: 0,
  };

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, display_name, morning_time, evening_time, morning_push_sent_on, evening_push_sent_on, plan_renewal_push_sent_on, tone, timezone",
    )
    .eq("onboarding_completed", true);
  if (error) throw error;
  const rows = (profiles ?? []) as ProfileRow[];

  // Un reloj por perfil, cada uno en su zona horaria. Todo lo que sigue ("¿cae
  // en la ventana?", "¿ya se avisó hoy?", "¿quedan pocos días de mes?") se
  // evalúa contra el reloj de esa persona.
  const clocks = new Map(rows.map((p) => [p.id, clockFor(p.timezone)]));
  const clockOf = (p: ProfileRow) => clocks.get(p.id) ?? clockFor(p.timezone);
  const nextMonthOf = (p: ProfileRow) => nextMonthISO(clockOf(p).today);

  const morningMatches = rows.filter((p) => {
    const { nowMinutes, today } = clockOf(p);
    return p.morning_push_sent_on !== today && inWindow(timeToMinutes(p.morning_time), nowMinutes);
  });
  const eveningMatches = rows.filter((p) => {
    const { nowMinutes, today } = clockOf(p);
    return p.evening_push_sent_on !== today && inWindow(timeToMinutes(p.evening_time), nowMinutes);
  });

  // A `RENEWAL_DAYS_LEFT` días o menos de fin de mes, si todavía no hay plan del
  // mes siguiente (y no se avisó ya hoy), se avisa una vez al día hasta que lo
  // generen — a mano desde Plan (donde ese mismo umbral desbloquea el mes que
  // viene) o solo al entrar el día 1 (ver auto-generación en Hoy).
  const renewalCandidates = rows.filter((p) => {
    const { today } = clockOf(p);
    return daysLeftInMonth(today) <= RENEWAL_DAYS_LEFT && p.plan_renewal_push_sent_on !== today;
  });
  let renewalMatches: ProfileRow[] = [];
  if (renewalCandidates.length) {
    const nextMonths = [...new Set(renewalCandidates.map(nextMonthOf))];
    const { data: nextPlans } = await supabaseAdmin
      .from("monthly_plans")
      .select("user_id, month")
      .in("month", nextMonths)
      .in(
        "user_id",
        renewalCandidates.map((p) => p.id),
      );
    const alreadyPlanned = new Set(
      (nextPlans ?? []).map((r) => {
        const row = r as { user_id: string; month: string };
        return `${row.user_id}|${row.month}`;
      }),
    );
    renewalMatches = renewalCandidates.filter(
      (p) => !alreadyPlanned.has(`${p.id}|${nextMonthOf(p)}`),
    );
  }

  if (!morningMatches.length && !eveningMatches.length && !renewalMatches.length) return summary;

  const matchedIds = [
    ...new Set([...morningMatches, ...eveningMatches, ...renewalMatches].map((p) => p.id)),
  ];
  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", matchedIds);

  const subsByUser = new Map<string, SubscriptionRow[]>();
  for (const s of (subs ?? []) as SubscriptionRow[]) {
    const list = subsByUser.get(s.user_id) ?? [];
    list.push(s);
    subsByUser.set(s.user_id, list);
  }

  // Procesa items en lotes de `concurrency` en paralelo. JS es single-threaded,
  // así que las mutaciones a `summary` entre awaits no hacen race conditions.
  const CONCURRENCY = 10;
  async function batch<T>(items: T[], fn: (item: T) => Promise<void>) {
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      await Promise.allSettled(items.slice(i, i + CONCURRENCY).map(fn));
    }
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
          const result = await sendPushNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          if (result === "gone") {
            summary.gone++;
            await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          } else {
            summary.sent++;
          }
        } catch (err) {
          summary.errors++;
          console.error("dispatchPush: fallo al enviar", userId, err);
        }
      }),
    );
  };

  await batch(morningMatches, async (p) => {
    const { today } = clockOf(p);
    const { data: log } = await supabaseAdmin
      .from("daily_logs")
      .select("guide")
      .eq("user_id", p.id)
      .eq("log_date", today)
      .maybeSingle();
    const firstMealIdea = (log?.guide as unknown as DailyGuide | null)?.meals?.[0]?.idea;
    const { title, body } = morningCopy(toneOf(p.tone), p.display_name, firstMealIdea);
    await sendTo(p.id, { title, body, url: "/hoy" });
    // Se marca como enviado tanto si había suscripciones como si no, para no
    // reintentar en bucle dentro del mismo día — igual para la noche debajo.
    await supabaseAdmin.from("profiles").update({ morning_push_sent_on: today }).eq("id", p.id);
  });

  await batch(eveningMatches, async (p) => {
    const { today } = clockOf(p);
    const tone = toneOf(p.tone);
    const { data: log } = await supabaseAdmin
      .from("daily_logs")
      .select("habits")
      .eq("user_id", p.id)
      .eq("log_date", today)
      .maybeSingle();
    const habits = (log?.habits as { done: boolean }[] | null) ?? [];
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
    await supabaseAdmin.from("profiles").update({ evening_push_sent_on: today }).eq("id", p.id);
  });

  if (renewalMatches.length) {
    // Un no planificador del hogar recibe un aviso distinto: la renovación del
    // menú de la casa no es cosa suya (issue 08, D1).
    const { data: memberRows } = await supabaseAdmin
      .from("household_members")
      .select("user_id, is_planner")
      .in(
        "user_id",
        renewalMatches.map((p) => p.id),
      );
    const nonPlanner = new Set(
      ((memberRows ?? []) as { user_id: string | null; is_planner: boolean }[])
        .filter((m) => m.user_id && !m.is_planner)
        .map((m) => m.user_id as string),
    );
    await batch(renewalMatches, async (p) => {
      const { today } = clockOf(p);
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
      await supabaseAdmin
        .from("profiles")
        .update({ plan_renewal_push_sent_on: today })
        .eq("id", p.id);
    });
  }

  return summary;
}
