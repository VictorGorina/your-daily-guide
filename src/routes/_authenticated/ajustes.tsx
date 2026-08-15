import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, ChevronRight, Info, Pencil, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { deleteAccount } from "@/lib/account.functions";
import { fetchProfile, saveProfile, type Profile } from "@/lib/daily";
import { applyTheme, THEMES } from "@/lib/theme";

function FieldNote({ error, help }: { error?: string; help: string }) {
  if (error)
    return (
      <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
      </p>
    );
  return <p className="mt-1 text-[11px] text-muted-foreground">{help}</p>;
}

export const Route = createFileRoute("/_authenticated/ajustes")({
  component: Ajustes,
});

function Ajustes() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;

  const save = useMutation({
    mutationFn: (patch: Partial<Profile>) => saveProfile(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
    onError: () => toast.error("No hemos podido guardar"),
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const setError = (key: string, message?: string) =>
    setErrors((e) => {
      const next = { ...e };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  const commitNumber = (
    key: "current_weight_kg" | "height_cm" | "goal_amount",
    raw: string,
    min: number,
    max: number,
    message: string,
    required: boolean,
  ) => {
    const text = raw.trim();
    if (!text) {
      if (required) {
        setError(key, "Este dato es necesario para tu progreso");
        return;
      }
      setError(key);
      save.mutate({ [key]: null } as Partial<Profile>);
      return;
    }
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max) {
      setError(key, message);
      return;
    }
    setError(key);
    save.mutate({ [key]: n } as Partial<Profile>);
  };

  const commitTime = (key: "morning_time" | "evening_time", raw: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
      setError(key, "Indica una hora válida (HH:MM)");
      return;
    }
    setError(key);
    save.mutate({ [key]: raw } as Partial<Profile>);
  };

  const missing = [
    profile && !profile.current_weight_kg ? "peso actual" : null,
    profile && !profile.height_cm ? "altura" : null,
    profile && !profile.morning_time ? "hora del resumen matutino" : null,
    profile && !profile.evening_time ? "hora del repaso nocturno" : null,
  ].filter(Boolean) as string[];

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const callDeleteAccount = useServerFn(deleteAccount);
  const [deleting, setDeleting] = useState(false);

  const removeAccount = async () => {
    setDeleting(true);
    try {
      await callDeleteAccount();
      await qc.cancelQueries();
      qc.clear();
      await supabase.auth.signOut();
      toast.success("Tu cuenta se ha eliminado");
      navigate({ to: "/", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No hemos podido eliminar tu cuenta");
    } finally {
      setDeleting(false);
    }
  };

  const input =
    "h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      <h1 className="font-display text-3xl">Ajustes</h1>

      {missing.length ? (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-primary/30 bg-primary-soft px-4 py-3 text-xs">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            Para que el progreso y los avisos funcionen bien, completa: {missing.join(", ")}.
          </span>
        </div>
      ) : null}

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Cuenta
      </span>
      <div className="surface-card mt-2 divide-y divide-border overflow-hidden">
        <Link to="/hogar" className="flex items-center gap-3 px-4 py-4 text-sm">
          <Users className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Tu hogar</span>
            <span className="block text-xs text-muted-foreground">
              Une cuentas, elige qué comidas compartís y añade a los peques
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
        <Link to="/perfil" className="flex items-center gap-3 px-4 py-4 text-sm">
          <Pencil className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">Editar mis respuestas</span>
            <span className="block text-xs text-muted-foreground">
              Corrige cualquier dato del onboarding en dos toques
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </div>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Perfil
      </span>
      <section className="surface-card mt-2 space-y-4 p-5">
        <h2 className="text-sm font-semibold">Datos básicos</h2>
        <input
          className={input}
          defaultValue={profile?.display_name ?? ""}
          placeholder="Nombre"
          onBlur={(e) => save.mutate({ display_name: e.target.value || null })}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              className={input}
              inputMode="decimal"
              defaultValue={profile?.current_weight_kg ?? ""}
              placeholder="Peso (kg)"
              onBlur={(e) =>
                commitNumber(
                  "current_weight_kg",
                  e.target.value,
                  25,
                  350,
                  "El peso debe estar entre 25 y 350 kg",
                  true,
                )
              }
            />
            <FieldNote
              error={errors["current_weight_kg"]}
              help="Necesario para calcular tu progreso."
            />
          </div>
          <div>
            <input
              className={input}
              inputMode="decimal"
              defaultValue={profile?.height_cm ?? ""}
              placeholder="Altura (cm)"
              onBlur={(e) =>
                commitNumber(
                  "height_cm",
                  e.target.value,
                  100,
                  250,
                  "La altura debe estar entre 100 y 250 cm",
                  true,
                )
              }
            />
            <FieldNote error={errors["height_cm"]} help="Ajusta las cantidades de tu guía." />
          </div>
        </div>
        <div>
          <input
            className={input}
            inputMode="decimal"
            defaultValue={profile?.goal_amount ?? ""}
            placeholder="Objetivo (kg)"
            onBlur={(e) =>
              commitNumber(
                "goal_amount",
                e.target.value,
                0.5,
                100,
                "El objetivo debe estar entre 0,5 y 100 kg",
                false,
              )
            }
          />
          <FieldNote
            error={errors["goal_amount"]}
            help="Opcional: kg que quieres perder o ganar."
          />
        </div>
      </section>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Coach
      </span>
      <section className="surface-card mt-2 divide-y divide-border p-5">
        <div>
          <h2 className="text-sm font-semibold">Tono</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {["relajado", "neutro", "exigente"].map((t) => (
              <button
                key={t}
                onClick={() => save.mutate({ tone: t })}
                className={`rounded-2xl border px-3 py-3 text-sm capitalize transition-colors ${
                  profile?.tone === t
                    ? "border-primary bg-primary-soft text-primary"
                    : "border-input bg-surface"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4">
          <h2 className="text-sm font-semibold">Recordatorios</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-xs text-muted-foreground">
              Mañana
              <input
                type="time"
                className={`${input} mt-1`}
                defaultValue={profile?.morning_time?.slice(0, 5) ?? "08:00"}
                onBlur={(e) => commitTime("morning_time", e.target.value)}
              />
              <FieldNote error={errors["morning_time"]} help="Hora del resumen matutino." />
            </label>
            <label className="text-xs text-muted-foreground">
              Noche
              <input
                type="time"
                className={`${input} mt-1`}
                defaultValue={profile?.evening_time?.slice(0, 5) ?? "21:30"}
                onBlur={(e) => commitTime("evening_time", e.target.value)}
              />
              <FieldNote error={errors["evening_time"]} help="Hora del repaso nocturno." />
            </label>
          </div>
        </div>
      </section>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Apariencia
      </span>
      <section className="surface-card mt-2 p-5">
        <h2 className="text-sm font-semibold">Tema</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                applyTheme(t.id);
                save.mutate({ theme: t.id });
              }}
              className={`rounded-2xl border p-3 text-left transition-colors ${
                profile?.theme === t.id ? "border-primary" : "border-input"
              }`}
            >
              <span className="flex gap-1">
                {t.swatch.map((c) => (
                  <span
                    key={c}
                    className="h-5 w-5 rounded-full border border-border"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              <span className="mt-2 block text-xs font-medium">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Datos y cuenta
      </span>

      <button
        onClick={signOut}
        className="mt-2 w-full rounded-full border border-input py-4 text-sm font-medium text-muted-foreground"
      >
        Cerrar sesión
      </button>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button className="mt-3 w-full rounded-full border border-destructive/30 py-4 text-sm font-medium text-destructive">
            Eliminar cuenta
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar tu cuenta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borrará tu perfil, tus guías, tu plan y tu progreso. Es permanente y no se puede
              deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeAccount}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Eliminando..." : "Sí, eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </main>
  );
}
