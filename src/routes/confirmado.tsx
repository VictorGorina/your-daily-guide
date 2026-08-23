import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

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
  const { next, error_description } = Route.useSearch();
  const [status, setStatus] = useState<"waiting" | "confirmed" | "error">(
    error_description ? "error" : "waiting",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    error_description ? decodeURIComponent(error_description.replace(/\+/g, " ")) : undefined,
  );

  useEffect(() => {
    // Cuando el enlace ha caducado o ya se ha usado, Supabase añade el
    // motivo a la URL — pero según el caso lo pone en la query string
    // (?error_description=...) o en el fragmento (#error=...&error_description=...,
    // el mismo sitio donde van los tokens del flujo implícito). El router
    // sólo nos da la query string, así que miramos también el hash antes de
    // quedarnos esperando una sesión que ya no va a llegar.
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
            <h1 className="mt-6 font-display text-3xl">Confirmando tu cuenta…</h1>
            <p className="mt-2 text-sm text-muted-foreground">Un momento, ya casi está.</p>
          </>
        )}

        {status === "confirmed" && (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
            <h1 className="mt-6 font-display text-3xl">¡Cuenta confirmada!</h1>
            <p className="mt-2 text-sm text-muted-foreground">Entrando en Peppers…</p>
          </>
        )}

        {status === "error" && (
          <>
            <TriangleAlert className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="mt-6 font-display text-3xl">Este enlace ya no funciona</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {errorMessage ||
                "Puede haber caducado o usarse ya. Entra de nuevo para pedir uno nuevo."}
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
