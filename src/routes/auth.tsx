import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shuffle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { saveProfile } from "@/lib/daily";
import { randomDemoProfile } from "@/lib/demo-profile";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    typeof search.next === "string" && search.next.startsWith("/") ? { next: search.next } : {},
  head: () => ({
    meta: [
      { title: "Entrar en Peppers" },
      { name: "description", content: "Accede a tu asistente de alimentación con IA." },
      { property: "og:title", content: "Entrar en Peppers" },
      { property: "og:description", content: "Accede a tu asistente de alimentación con IA." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const goNext = () => {
    if (next) {
      window.location.replace(next);
      return true;
    }
    return false;
  };

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        if (!goNext()) navigate({ to: "/hoy", replace: true });
      }
    });
    // Same race as on "/": a confirmation/magic-link redirect's URL tokens are
    // parsed asynchronously, so getSession() above can run before that finishes.
    // Catch the SIGNED_IN event it fires once the session is actually ready.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        if (!goNext()) navigate({ to: "/hoy", replace: true });
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, next]);

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      toast.error("Necesito tu correo y una contraseña de al menos 6 caracteres");
      return;
    }
    setLoading(true);
    try {
      if (mode === "up") {
        // El enlace del correo debe apuntar a una URL pública y estable, no a
        // localhost ni al esquema de la app nativa (un correo se abre en otro
        // sitio). Se toma de VITE_PUBLIC_URL si está definida; sólo cae al origin
        // actual como último recurso en desarrollo. Esa URL + /confirmado tiene
        // que estar en la allowlist de Redirect URLs del panel de Supabase.
        const base =
          (import.meta.env.VITE_PUBLIC_URL as string | undefined) || window.location.origin;
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${base}/confirmado${next ? `?next=${encodeURIComponent(next)}` : ""}`,
          },
        });
        if (error) throw error;
        if (!data.session) {
          setSent(true);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
      if (!goNext()) navigate({ to: "/hoy", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No hemos podido entrar");
    } finally {
      setLoading(false);
    }
  };

  const demo = async () => {
    setDemoLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const { error } = await supabase.auth.signInAnonymously();
        if (error) throw error;
      }
      await saveProfile(randomDemoProfile());
      toast.success("Perfil de prueba creado");
      navigate({ to: "/hoy", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No hemos podido crear el perfil");
    } finally {
      setDemoLoading(false);
    }
  };

  const google = async () => {
    // Redirige el navegador a Google vía el proveedor OAuth de Supabase (debe
    // estar habilitado en el dashboard de Supabase del proyecto: Authentication
    // → Providers → Google). Al volver, el listener SIGNED_IN de arriba lleva
    // a la persona a donde tocaba.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: next ? `${window.location.origin}${next}` : window.location.origin,
      },
    });
    if (error) toast.error("No hemos podido conectar con Google");
  };

  const field =
    "h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-14">
      <div className="animate-rise">
        <h1 className="font-display text-4xl">
          {mode === "in" ? "Bienvenido de vuelta" : "Empecemos"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "in"
            ? "Entra con tu correo y sigue donde lo dejaste."
            : "Crea tu cuenta y tu coach te acompaña desde hoy."}
        </p>

        {sent ? (
          <div className="mt-8 rounded-2xl border border-primary/30 bg-primary-soft px-4 py-4 text-sm">
            Te he enviado un correo para confirmar tu cuenta. Ábrelo y vuelve aquí para entrar.
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            <input
              className={field}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
            />
            <input
              className={field}
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
            />
            <button
              onClick={submit}
              disabled={loading}
              className="w-full rounded-full bg-primary py-4 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {loading ? "Un momento..." : mode === "in" ? "Entrar" : "Crear cuenta"}
            </button>
            <button
              onClick={() => setMode(mode === "in" ? "up" : "in")}
              className="w-full py-2 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {mode === "in"
                ? "No tengo cuenta todavía, quiero crearla"
                : "Ya tengo cuenta, quiero entrar"}
            </button>
          </div>
        )}

        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> o <span className="h-px flex-1 bg-border" />
        </div>

        <button
          onClick={google}
          className="w-full rounded-full border border-input bg-surface py-4 text-sm font-medium text-foreground transition-transform active:scale-[0.98]"
        >
          Continuar con Google
        </button>

        <button
          onClick={demo}
          disabled={demoLoading}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-input bg-surface py-3.5 text-sm font-medium text-muted-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          <Shuffle className="h-4 w-4" />
          {demoLoading ? "Creando perfil..." : "Probar con un perfil aleatorio"}
        </button>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Con tu cuenta puedes entrar y salir cuando quieras, y unir tu hogar con quien vive
          contigo.
        </p>
      </div>
    </main>
  );
}
