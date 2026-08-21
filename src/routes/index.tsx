import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { HeartPulse, Sparkle, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Peppers — Tu asistente de alimentación con IA" },
      {
        name: "description",
        content:
          "Come mejor cada día, sin complicaciones: guía matutina, repaso nocturno y un objetivo medible con progreso visual. Sin dietas rígidas.",
      },
      { property: "og:title", content: "Peppers — Tu asistente de alimentación con IA" },
      {
        property: "og:description",
        content: "Hábitos, no restricciones. Un asistente que te acompaña cada día.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/hoy", replace: true });
    });
    // The confirmation link's tokens (in the URL hash) are parsed asynchronously
    // by supabase-js. Listening for SIGNED_IN too, not just the getSession()
    // check above, makes sure clicking "confirm email" reliably lands the user
    // in the app even if that parsing is still in flight on mount.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/hoy", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-between px-6 pb-10 pt-16">
      <div className="animate-rise">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary">
          <Sparkle className="h-3.5 w-3.5" /> Tu asistente de alimentación con IA
        </span>
        <h1 className="mt-6 font-display text-5xl leading-[1.05] text-foreground">
          <span className="text-gradient-primary">Peppers</span>
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Para comer mejor cada día, sin complicaciones. Te da una guía flexible por la mañana,
          repasa contigo la noche y convierte tu objetivo en progreso que puedes ver.
        </p>

        <ul className="mt-10 space-y-3">
          {[
            { icon: HeartPulse, text: "Hábitos y bienestar, nunca dietas rígidas" },
            { icon: TrendingUp, text: "Objetivo medible con progreso visual y rachas" },
            { icon: Sparkle, text: "Tono relajado, neutro o exigente: tú eliges" },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="surface-card flex items-center gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 text-sm text-foreground">{text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-12 space-y-3">
        <Link
          to="/auth"
          className="flex h-13 w-full items-center justify-center rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          Empezar ahora
        </Link>
        <p className="text-center text-xs text-muted-foreground">
          Guía flexible de bienestar. Calorías y macros son estimaciones orientativas, no un conteo
          nutricional exacto. No sustituye consejo médico.
        </p>
      </div>
    </main>
  );
}
