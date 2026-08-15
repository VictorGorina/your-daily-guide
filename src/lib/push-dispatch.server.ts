import type { DailyGuide } from "@/lib/daily";
import { sendPushNotification, type PushPayload } from "@/lib/web-push.server";

export type DispatchSummary = {
  sent: number;
  gone: number;
  skippedNoSubscription: number;
  errors: number;
};

// La app es en español, para un único uso en España: sin campo de zona
// horaria en el perfil, se asume Europe/Madrid para comparar morning_time/
// evening_time contra la hora actual.
const TIMEZONE = "Europe/Madrid";

// Ventana de 20 min hacia atrás: algo más ancha que la cadencia del workflow
// de GitHub Actions (cada 15 min) para absorber el jitter típico de los
// schedules de Actions sin dejar ningún hueco sin cubrir.
const WINDOW_MINUTES = 20;

function madridMinutesNow(): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function madridDateISO(): string {
  // Locale en-CA formatea como YYYY-MM-DD, cómodo para comparar con `date`.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
}

function timeToMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{2}):(\d{2})/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

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
};

type SubscriptionRow = { user_id: string; endpoint: string; p256dh: string; auth: string };

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
  const summary: DispatchSummary = { sent: 0, gone: 0, skippedNoSubscription: 0, errors: 0 };

  const nowMinutes = madridMinutesNow();
  const today = madridDateISO();

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, display_name, morning_time, evening_time, morning_push_sent_on, evening_push_sent_on",
    )
    .eq("onboarding_completed", true);
  if (error) throw error;
  const rows = (profiles ?? []) as ProfileRow[];

  const morningMatches = rows.filter(
    (p) => p.morning_push_sent_on !== today && inWindow(timeToMinutes(p.morning_time), nowMinutes),
  );
  const eveningMatches = rows.filter(
    (p) => p.evening_push_sent_on !== today && inWindow(timeToMinutes(p.evening_time), nowMinutes),
  );
  if (!morningMatches.length && !eveningMatches.length) return summary;

  const matchedIds = [...new Set([...morningMatches, ...eveningMatches].map((p) => p.id))];
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

  const sendTo = async (userId: string, payload: PushPayload) => {
    const userSubs = subsByUser.get(userId) ?? [];
    if (!userSubs.length) {
      summary.skippedNoSubscription++;
      return;
    }
    for (const s of userSubs) {
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
    }
  };

  for (const p of morningMatches) {
    const { data: log } = await supabaseAdmin
      .from("daily_logs")
      .select("guide")
      .eq("user_id", p.id)
      .eq("log_date", today)
      .maybeSingle();
    const firstMealIdea = (log?.guide as unknown as DailyGuide | null)?.meals?.[0]?.idea;
    await sendTo(p.id, {
      title: p.display_name ? `Buenos días, ${p.display_name}` : "Buenos días",
      body: firstMealIdea ? `Hoy toca: ${firstMealIdea}` : "Tu guía de hoy ya te está esperando.",
      url: "/hoy",
    });
    // Se marca como enviado tanto si había suscripciones como si no, para no
    // reintentar en bucle dentro del mismo día — igual para la noche debajo.
    await supabaseAdmin.from("profiles").update({ morning_push_sent_on: today }).eq("id", p.id);
  }

  for (const p of eveningMatches) {
    await sendTo(p.id, {
      title: p.display_name ? `¿Cómo ha ido tu día, ${p.display_name}?` : "¿Cómo ha ido tu día?",
      body: "Repásalo en menos de un minuto.",
      url: "/hoy",
    });
    await supabaseAdmin.from("profiles").update({ evening_push_sent_on: today }).eq("id", p.id);
  }

  return summary;
}
