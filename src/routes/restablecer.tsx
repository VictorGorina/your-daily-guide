import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
  const { next, error_description } = Route.useSearch();
  const [status, setStatus] = useState<"waiting" | "ready" | "done" | "error">(
    error_description ? "error" : "waiting",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    error_description ? decodeURIComponent(error_description.replace(/\+/g, " ")) : undefined,
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Cuando el enlace ha caducado o ya se ha usado, Supabase añade el
    // motivo a la URL — pero según el caso lo pone en la query string
    // (?error_description=...) o en el fragmento (#error=...&error_description=...,
    // el mismo sitio donde van los tokens del flujo implícito). El router
    // sólo nos da la query string, así que miramos también el hash antes de
    // quedarnos esperando un evento que ya no va a llegar.
    // (URLSearchParams ya decodifica %XX y "+" al leerlo, a diferencia del
    // error_description de la query string, que llega crudo.)
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashError = hashParams.get("error_description") || hashParams.get("error");
    const initialError =
      (error_description && decodeURIComponent(error_description.replace(/\+/g, " "))) || hashError;
    if (initialError) {
      setErrorMessage(initialError);
      setStatus("error");
      return;
    }

    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session)
        setStatus((current) => (current === "waiting" ? "ready" : current));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !cancelled) setStatus("ready");
    });

    // Si tras unos segundos no ha llegado el evento de recuperación, el
    // enlace no era válido: no dejamos a la persona esperando para siempre.
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
      toast.error("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    if (password !== confirm) {
      toast.error("Las dos contraseñas no coinciden");
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
      toast.error(error instanceof Error ? error.message : "No hemos podido guardar la contraseña");
    } finally {
      setSaving(false);
    }
  };

  const field =
    "h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="animate-rise w-full">
        {status === "waiting" && (
          <>
            <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-primary" />
            <h1 className="mt-6 font-display text-3xl">Comprobando el enlace…</h1>
            <p className="mt-2 text-sm text-muted-foreground">Un momento, ya casi está.</p>
          </>
        )}

        {status === "ready" && (
          <>
            <h1 className="font-display text-3xl">Crea tu contraseña nueva</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Elige una contraseña de al menos 6 caracteres.
            </p>
            <div className="mt-8 space-y-3 text-left">
              <input
                className={field}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña nueva"
              />
              <input
                className={field}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repite la contraseña"
              />
              <button
                onClick={submit}
                disabled={saving}
                className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
              >
                {saving ? "Guardando..." : "Guardar contraseña"}
              </button>
            </div>
          </>
        )}

        {status === "done" && (
          <>
            <h1 className="mt-6 font-display text-3xl">¡Contraseña actualizada!</h1>
            <p className="mt-2 text-sm text-muted-foreground">Entrando en Peppers…</p>
          </>
        )}

        {status === "error" && (
          <>
            <TriangleAlert className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="mt-6 font-display text-3xl">Este enlace ya no funciona</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {errorMessage ||
                "Puede haber caducado o usarse ya. Pide un enlace nuevo desde la pantalla de entrar."}
            </p>
            <button
              onClick={() => navigate({ to: "/auth" })}
              className="mt-6 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
            >
              Volver a entrar
            </button>
          </>
        )}
      </div>
    </main>
  );
}
