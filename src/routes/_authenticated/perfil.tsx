import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, Check, ChevronLeft, Pencil, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { DictateButton } from "@/components/dictate-button";
import { ageFromDOB } from "@/lib/age";
import { fetchProfile, saveProfile, type Profile } from "@/lib/daily";
import { PROFILE_SECTIONS, type ProfileField as Field } from "@/lib/profile-fields";

const SECTIONS = PROFILE_SECTIONS;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validate(field: Field, raw: string): { error?: string; value?: unknown } {
  const text = raw.trim();
  if (field.kind === "number") {
    if (!text) return { value: null };
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < (field.min ?? 0) || n > (field.max ?? Infinity))
      return {
        error: `Indica un valor entre ${field.min} y ${field.max}${field.unit ? ` ${field.unit}` : ""}`,
      };
    return { value: n };
  }
  if (field.kind === "time") {
    if (!TIME_RE.test(text)) return { error: "Indica una hora válida (HH:MM)" };
    return { value: text };
  }
  if (field.kind === "date") {
    if (!text) return { value: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: "Indica una fecha válida" };
    if (field.key === "date_of_birth") {
      const age = ageFromDOB(text);
      if (age === null || age < 12 || age > 110)
        return { error: "Indica una fecha de nacimiento real" };
    }
    return { value: text };
  }
  return { value: text || null };
}

function display(field: Field, profile: Profile | null | undefined) {
  const value = profile ? (profile[field.key] as unknown) : null;
  if (value === null || value === undefined || value === "") return null;
  if (field.kind === "time") return String(value).slice(0, 5);
  if (field.kind === "number") return `${value}${field.unit ? ` ${field.unit}` : ""}`;
  if (field.key === "date_of_birth") {
    const age = ageFromDOB(String(value));
    const [y, m, d] = String(value).split("-");
    return `${d}/${m}/${y}${age !== null ? ` · ${age} años` : ""}`;
  }
  return String(value);
}

export const Route = createFileRoute("/_authenticated/perfil")({
  component: Perfil,
  head: () => ({
    meta: [
      { title: "Mis respuestas · Daily Guide" },
      {
        name: "description",
        content: "Revisa y corrige en dos toques cualquier respuesta de tu perfil de Daily Guide.",
      },
      { property: "og:title", content: "Mis respuestas · Daily Guide" },
      {
        property: "og:description",
        content: "Edita tus datos de salud, rutina y objetivos sin repetir el onboarding.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Perfil() {
  const qc = useQueryClient();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: (patch: Partial<Profile>) => saveProfile(patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["profile"] });
      qc.removeQueries({ queryKey: ["today"] });
      toast.success("Guardado");
    },
    onError: () => toast.error("No hemos podido guardar"),
  });

  const open = (field: Field) => {
    const value = profile ? (profile[field.key] as unknown) : null;
    setEditing(String(field.key));
    setError(undefined);
    setDraft(
      value === null || value === undefined
        ? ""
        : field.kind === "time"
          ? String(value).slice(0, 5)
          : String(value),
    );
  };

  const commit = (field: Field, raw?: string) => {
    const { error: err, value } = validate(field, raw ?? draft);
    if (err) {
      setError(err);
      return;
    }
    save.mutate({ [field.key]: value } as Partial<Profile>);
    setEditing(null);
  };

  const input =
    "h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-10">
      <Link
        to="/ajustes"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Ajustes
      </Link>
      <h1 className="mt-3 font-display text-3xl">Mis respuestas</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Toca cualquier respuesta para corregirla. No hace falta repetir el onboarding.
      </p>

      {SECTIONS.map((section) => (
        <section key={section.title} className="surface-card mt-5 p-4">
          <h2 className="px-1 text-sm font-semibold">{section.title}</h2>
          <ul className="mt-2 divide-y divide-border">
            {section.fields.map((field) => {
              const isEditing = editing === String(field.key);
              const shown = display(field, profile);
              return (
                <li key={String(field.key)} className="py-2">
                  {isEditing ? (
                    <div className="rounded-2xl bg-primary-soft/40 p-3">
                      <p className="text-xs font-medium">{field.label}</p>
                      {field.kind === "chips" ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {field.options?.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => commit(field, opt)}
                              className={`rounded-full border px-3 py-2 text-xs capitalize ${
                                draft === opt
                                  ? "border-primary bg-primary-soft text-primary"
                                  : "border-input bg-surface"
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      ) : field.kind === "long" ? (
                        <>
                          <textarea
                            autoFocus
                            rows={3}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            className="mt-2 w-full rounded-2xl border border-input bg-surface px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                          />
                          <DictateButton
                            className="mt-2"
                            onText={(t) => setDraft((d) => (d ? `${d} ${t}` : t))}
                          />
                        </>
                      ) : (
                        <input
                          autoFocus
                          className={`${input} mt-2`}
                          type={
                            field.kind === "time" ? "time" : field.kind === "date" ? "date" : "text"
                          }
                          inputMode={field.kind === "number" ? "decimal" : undefined}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commit(field);
                          }}
                        />
                      )}

                      {error ? (
                        <p className="mt-2 flex items-start gap-1 text-[11px] text-destructive">
                          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
                        </p>
                      ) : null}

                      {field.kind !== "chips" ? (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => commit(field)}
                            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary py-2.5 text-xs font-semibold text-primary-foreground"
                          >
                            <Check className="h-3.5 w-3.5" /> Guardar
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-input px-4 py-2.5 text-xs font-medium text-muted-foreground"
                          >
                            <X className="h-3.5 w-3.5" /> Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditing(null)}
                          className="mt-3 text-[11px] font-medium text-muted-foreground"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => open(field)}
                      className="flex w-full items-start gap-3 rounded-2xl px-1 py-2 text-left transition-colors active:bg-primary-soft/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-muted-foreground">{field.label}</span>
                        <span
                          className={`mt-0.5 block text-sm ${shown ? "" : "italic text-muted-foreground"}`}
                        >
                          {shown ?? "Sin responder — toca para añadir"}
                        </span>
                      </span>
                      <Pencil className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <BottomNav />
    </main>
  );
}
