import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { supabase } from "@/integrations/supabase/client";
import { safeInternalPath } from "@/lib/safe-next";

// Página a la que apunta el enlace del correo de confirmación (ver
// emailRedirectTo en src/routes/auth.tsx). Supabase procesa el token de la
// URL en cuanto carga supabase-js y dispara SIGNED_IN; aquí solo esperamos
// ese evento (o una sesión ya lista) y saltamos a la app. Si el enlace ha
// caducado o ya se usó, Supabase añade `error_description` en la URL.
export const Route = createFileRoute("/confirmado")({
  ssr: false,
  validateSearch: (
    search: Record<string, unknown>,
  ): { next?: string; error_description?: string } => ({
    next: safeInternalPath(search.next as string | undefined),
    error_description:
      typeof search.error_description === "string" ? search.error_description : undefined,
  }),
  head: () => ({
    meta: [{ title: "Cuenta confirmada — Peppers" }],
  }),
  component: ConfirmadoPage,
});

function ConfirmadoPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { next, error_description } = Route.useSearch();
  const [status, setStatus] = useState<"waiting" | "confirmed" | "error">(
    error_description ? "error" : "waiting",
  );

  useEffect(() => {
    // Cuando el enlace ha caducado o ya se ha usado, Supabase añade el
    // motivo a la URL — pero según el caso lo pone en la query string
    // (?error_description=...) o en el fragmento (#error=...&error_description=...,
    // el mismo sitio donde van los tokens del flujo implícito). El router
    // sólo nos da la query string, así que miramos también el hash antes de
    // quedarnos esperando una sesión que ya no va a llegar.
    //
    // El motivo NUNCA se enseña en pantalla: es texto que viene tal cual de la
    // URL, así que cualquiera puede fabricar un enlace con lo que quiera en
    // error_description (era un vector de phishing — auditoría de auth,
    // 2026-09-13). Como mucho se registra en consola para depurar; el estado
    // de error ya explica en español qué hacer, igual que restablecer.tsx.
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasUrlError =
      Boolean(error_description) || hashParams.has("error_description") || hashParams.has("error");
    if (hasUrlError) {
      console.warn(
        "confirmado: enlace con error",
        error_description || hashParams.get("error_description") || hashParams.get("error"),
      );
      setStatus("error");
      return;
    }

    let cancelled = false;
    const goApp = () => {
      if (cancelled) return;
      setStatus("confirmed");
      setTimeout(() => {
        if (!cancelled) window.location.replace(next || "/hoy");
      }, 900);
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) goApp();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) goApp();
    });

    // Si tras unos segundos no ha llegado ninguna sesión, el enlace no era
    // válido: no dejamos a la persona esperando para siempre.
    const timeout = setTimeout(() => {
      if (!cancelled) setStatus((current) => (current === "waiting" ? "error" : current));
    }, 8000);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [error_description, next]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="animate-rise">
        {status === "waiting" && (
          <>
            <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-primary" />
            <h1 className="mt-6 font-title text-3xl font-semibold tracking-[-0.03em]">
              {t("auth.confirm.confirming")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("auth.oneMoment")}</p>
          </>
        )}

        {status === "confirmed" && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
            <h1 className="mt-6 font-title text-3xl font-semibold tracking-[-0.03em]">
              {t("auth.confirm.confirmed")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("auth.enteringApp")}</p>
          </>
        )}

        {status === "error" && (
          <>
            <TriangleAlert className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="mt-6 font-title text-3xl font-semibold tracking-[-0.03em]">
              {t("auth.linkErrorTitle")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("auth.linkErrorBody")}</p>
            <button
              onClick={() => navigate({ to: "/auth" })}
              className="mt-6 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              {t("auth.backToSignIn")}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
