import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { authErrorText } from "@/lib/auth-errors";
import { supabase } from "@/integrations/supabase/client";
import { safeInternalPath } from "@/lib/safe-next";

// Página a la que apunta el enlace del correo de "olvidé mi contraseña" (ver
// redirectTo en forgotPassword de src/routes/auth.tsx). Supabase procesa el
// token de recuperación de la URL en cuanto carga supabase-js y dispara el
// evento PASSWORD_RECOVERY con una sesión ya activa; aquí esperamos ese
// evento y mostramos el formulario para fijar la contraseña nueva. Si el
// enlace ha caducado o ya se usó, Supabase añade `error_description` en la URL.
//
// Igual que en "/" y en confirmado.tsx: el procesado del token de la URL es
// asíncrono (un setTimeout(…, 0) interno de supabase-js), así que en una
// carga dura de página (clic desde el correo) el evento PASSWORD_RECOVERY
// puede disparase antes de que este efecto llegue a suscribirse — se
// perdería sin más señal. Por eso también comprobamos getSession() como
// respaldo: si el token ya se procesó, la sesión de recuperación ya está ahí.
// Pero SOLO cuando el enlace es de verdad de recuperación (`type=recovery`
// en el hash, que es lo que pone Supabase en el redirect): sin esa
// comprobación, el respaldo aceptaba CUALQUIER sesión abierta en el
// navegador —login normal, OAuth, incluso el perfil demo anónimo— y
// enseñaba el formulario para cambiarle la contraseña a esa cuenta con solo
// visitar /restablecer (auditoría de auth, 2026-09-13).
export const Route = createFileRoute("/restablecer")({
  ssr: false,
  validateSearch: (
    search: Record<string, unknown>,
  ): { next?: string; error_description?: string } => ({
    next: safeInternalPath(search.next as string | undefined),
    error_description:
      typeof search.error_description === "string" ? search.error_description : undefined,
  }),
  head: () => ({
    meta: [{ title: "Restablecer contraseña — Peppers" }],
  }),
  component: RestablecerPage,
});

function RestablecerPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { next, error_description } = Route.useSearch();
  const [status, setStatus] = useState<"waiting" | "ready" | "done" | "error">(
    error_description ? "error" : "waiting",
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Cuando el enlace ha caducado o ya se ha usado, Supabase añade el motivo a
    // la URL — según el caso en la query string (?error_description=...) o en el
    // fragmento (#error=...&error_description=..., el mismo sitio donde van los
    // tokens del flujo implícito). El router sólo nos da la query string, así
    // que miramos también el hash antes de quedarnos esperando un evento que ya
    // no va a llegar. No enseñamos ese texto (Supabase lo manda en inglés): el
    // estado de error ya explica en español qué hacer, igual que en móvil
    // (mobile/app/restablecer.tsx).
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hasUrlError =
      Boolean(error_description) || hashParams.has("error_description") || hashParams.has("error");
    if (hasUrlError) {
      setStatus("error");
      return;
    }

    // Único momento en el que confiamos en getSession() como respaldo del
    // evento (ver comentario de arriba de la ruta): el propio hash dice que
    // este enlace es de recuperación. Si no lo dice, puede ser cualquier otra
    // sesión abierta en el navegador y no debe enseñar el formulario.
    const isRecoveryLink = hashParams.get("type") === "recovery";

    let cancelled = false;
    if (isRecoveryLink) {
      supabase.auth.getSession().then(({ data }) => {
        if (!cancelled && data.session)
          setStatus((current) => (current === "waiting" ? "ready" : current));
      });
    }
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !cancelled) setStatus("ready");
    });

    // Si tras unos segundos no ha llegado el evento de recuperación, el
    // enlace no era válido (o no era un enlace de recuperación de verdad): no
    // dejamos a la persona esperando para siempre.
    const timeout = setTimeout(() => {
      if (!cancelled) setStatus((current) => (current === "waiting" ? "error" : current));
    }, 8000);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, [error_description]);

  const submit = async () => {
    if (password.length < 6) {
      toast.error(t("auth.errWeakPassword"));
      return;
    }
    if (password !== confirm) {
      toast.error(t("auth.reset.errMismatch"));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStatus("done");
      setTimeout(() => {
        window.location.replace(next || "/hoy");
      }, 1200);
    } catch (error) {
      // Nada de error.message crudo: Supabase lo manda en inglés (ver
      // auth-errors.ts, el mismo camino que usa auth-flow.tsx para entrar).
      toast.error(authErrorText(error, t, "auth.reset.errSave"));
    } finally {
      setSaving(false);
    }
  };

  const field =
    "h-12 w-full rounded-2xl bg-muted px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="animate-rise w-full">
        {status === "waiting" && (
          <>
            <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-primary" />
            <h1 className="mt-6 font-title text-3xl font-semibold tracking-[-0.03em]">
              {t("auth.reset.checkingLink")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("auth.oneMoment")}</p>
          </>
        )}

        {status === "ready" && (
          <>
            <h1 className="font-title text-3xl font-semibold tracking-[-0.03em]">
              {t("auth.reset.title")}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">{t("auth.reset.subtitle")}</p>
            <form
              className="mt-8 space-y-3 text-left"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <input
                className={field}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.reset.newPasswordPlaceholder")}
              />
              <input
                className={field}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("auth.reset.repeatPasswordPlaceholder")}
              />
              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {saving ? t("auth.reset.saving") : t("auth.reset.save")}
              </button>
            </form>
          </>
        )}

        {status === "done" && (
          <>
            <h1 className="mt-6 font-title text-3xl font-semibold tracking-[-0.03em]">
              {t("auth.reset.done")}
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
