import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertCircle, Check, ChevronLeft, Pencil, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { DictateButton } from "@/components/dictate-button";
import { DictationField, DictationWave } from "@/components/dictation-field";
import { ageFromDOB } from "@/lib/age";
import { fetchProfile, saveProfile, type Profile } from "@/lib/daily";
import { dateLocale } from "@/lib/i18n";
import { showsNutritionNumbers } from "@/lib/macros";
import { energyExplanation, energyTargets } from "@/lib/nutrition/energy";
import { portionExplanation, portionFactors } from "@/lib/nutrition/portion";
import {
  PROFILE_SECTIONS,
  chipToValue,
  valueToChip,
  type ProfileField as Field,
} from "@/lib/profile-fields";
import { useCurrencySymbol } from "@/lib/use-money";
import type { Translate } from "@/lib/week-nav";

const SECTIONS = PROFILE_SECTIONS;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** La moneda del presupuesto es la del perfil; el resto de unidades, las del campo. */
const fieldUnit = (field: Field, currency: string) =>
  field.key === "budget_month_eur" ? currency : field.unit;

/** Un chip se guarda en español canónico y se pinta por su posición en la lista. */
function chipLabel(field: Field, chip: string, t: Translate) {
  const index = field.options?.indexOf(chip) ?? -1;
  return index < 0 ? chip : t(`profileFields.${String(field.key)}.options.${index}`);
}

function validate(
  field: Field,
  raw: string,
  t: Translate,
  unit: string | undefined,
): { error?: string; value?: unknown } {
  const text = raw.trim();
  if (field.kind === "number") {
    if (!text) return { value: null };
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < (field.min ?? 0) || n > (field.max ?? Infinity))
      return {
        error: `${t("perfil.errors.range", { min: field.min ?? 0, max: field.max ?? 0 })}${unit ? ` ${unit}` : ""}`,
      };
    return { value: n };
  }
  if (field.kind === "time") {
    if (!TIME_RE.test(text)) return { error: t("perfil.errors.time") };
    return { value: text };
  }
  if (field.kind === "date") {
    if (!text) return { value: null };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { error: t("perfil.errors.date") };
    if (field.key === "date_of_birth") {
      const age = ageFromDOB(text);
      if (age === null || age < 12 || age > 110) return { error: t("perfil.errors.dob") };
    }
    return { value: text };
  }
  // Para chips con valueMap, convertir la etiqueta UI al valor interno.
  if (field.kind === "chips" && text) return { value: chipToValue(field, text) };
  return { value: text || null };
}

function display(
  field: Field,
  profile: Profile | null | undefined,
  t: Translate,
  unit: string | undefined,
) {
  const value = profile ? (profile[field.key] as unknown) : null;
  if (value === null || value === undefined || value === "") return null;
  if (field.kind === "time") return String(value).slice(0, 5);
  if (field.kind === "number") return `${value}${unit ? ` ${unit}` : ""}`;
  if (field.key === "date_of_birth") {
    const age = ageFromDOB(String(value));
    const [y, m, d] = String(value).split("-");
    return `${d}/${m}/${y}${age !== null ? ` · ${t("perfil.age", { count: age })}` : ""}`;
  }
  // Chips: la etiqueta de la pantalla, no el valor guardado.
  if (field.kind === "chips") return chipLabel(field, valueToChip(field, String(value)), t);
  return String(value);
}

export const Route = createFileRoute("/_authenticated/perfil")({
  component: Perfil,
  head: () => ({
    meta: [
      { title: "Mis respuestas · Peppers" },
      {
        name: "description",
        content: "Revisa y corrige en dos toques cualquier respuesta de tu perfil de Peppers.",
      },
      { property: "og:title", content: "Mis respuestas · Peppers" },
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
  // Ticket 07: de dónde sale su cifra, a la vista (solo si quiere ver cifras).
  const showNumbers = showsNutritionNumbers(profile);
  const energy = energyTargets(profile);

  const { t, i18n } = useTranslation();
  const numberLocale = dateLocale(i18n.language);
  const currency = useCurrencySymbol();

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | undefined>();

  const save = useMutation({
    mutationFn: (patch: Partial<Profile>) => saveProfile(patch),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["profile"] });
      qc.removeQueries({ queryKey: ["today"] });
      toast.success(t("common.saved"));
    },
    onError: () => toast.error(t("common.saveError")),
  });

  const open = (field: Field) => {
    const value = profile ? (profile[field.key] as unknown) : null;
    setEditing(String(field.key));
    setError(undefined);
    const str =
      value === null || value === undefined
        ? ""
        : field.kind === "time"
          ? String(value).slice(0, 5)
          : String(value);
    // Para chips con valueMap, el draft debe ser la etiqueta UI (la que se
    // compara con los botones), no el valor almacenado.
    setDraft(field.kind === "chips" && field.valueMap ? valueToChip(field, str) : str);
  };

  const commit = (field: Field, raw?: string) => {
    const { error: err, value } = validate(field, raw ?? draft, t, fieldUnit(field, currency));
    if (err) {
      setError(err);
      return;
    }
    save.mutate({ [field.key]: value } as Partial<Profile>);
    setEditing(null);
  };

  const input =
    "h-12 w-full rounded-2xl bg-muted px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-10">
      <Link
        to="/ajustes"
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> {t("ajustes.title")}
      </Link>
      <h1 className="mt-3 font-title text-[34px] font-semibold tracking-[-0.03em]">
        {t("perfil.title")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("perfil.intro")}</p>

      {showNumbers && energy ? (
        <section className="surface-card mt-5 p-4">
          <h2 className="px-1 text-sm font-semibold">{t("perfil.target.title")}</h2>
          <p className="mt-2 px-1 text-sm text-foreground">
            {energyExplanation(energy, t, numberLocale)}
          </p>
          <p className="mt-1 px-1 text-sm text-foreground">
            {portionExplanation(portionFactors(energy, profile), t, numberLocale)}
          </p>
          <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
            {t("perfil.target.note")}
          </p>
        </section>
      ) : null}

      {SECTIONS.map((section, sectionIndex) => (
        <section key={section.title} className="surface-card mt-5 p-4">
          <h2 className="px-1 text-sm font-semibold">{t(`perfil.sections.${sectionIndex}`)}</h2>
          <ul className="mt-2 divide-y divide-border">
            {section.fields.map((field) => {
              const isEditing = editing === String(field.key);
              const shown = display(field, profile, t, fieldUnit(field, currency));
              return (
                <li key={String(field.key)} className="py-2">
                  {isEditing ? (
                    <div className="rounded-2xl bg-primary-soft/40 p-3">
                      <p className="text-xs font-medium">
                        {t(`profileFields.${String(field.key)}.label`)}
                      </p>
                      {field.kind === "chips" ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {field.options?.map((opt) => (
                            <button
                              key={opt}
                              onClick={() => commit(field, opt)}
                              className={`rounded-full px-3 py-2 text-xs capitalize ${
                                draft === opt ? "bg-primary-soft text-primary-ink" : "bg-surface"
                              }`}
                            >
                              {chipLabel(field, opt, t)}
                            </button>
                          ))}
                        </div>
                      ) : field.kind === "long" ? (
                        <DictationField>
                          <div className="relative mt-2 rounded-2xl">
                            <textarea
                              autoFocus
                              rows={3}
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              className="block w-full rounded-2xl bg-surface px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                            />
                            <DictationWave />
                          </div>
                          <DictateButton
                            className="mt-2"
                            onText={(said) => setDraft((d) => (d ? `${d} ${said}` : said))}
                          />
                        </DictationField>
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

                      {field.help ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                          {t(`profileFields.${String(field.key)}.help`)}
                        </p>
                      ) : null}

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
                            <Check className="h-3.5 w-3.5" /> {t("common.save")}
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-surface px-4 py-2.5 text-xs font-medium text-muted-foreground"
                          >
                            <X className="h-3.5 w-3.5" /> {t("common.cancel")}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setEditing(null)}
                          className="mt-3 text-[11px] font-medium text-muted-foreground"
                        >
                          {t("common.cancel")}
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      onClick={() => open(field)}
                      className="flex w-full items-start gap-3 rounded-2xl px-1 py-2 text-left transition-colors active:bg-primary-soft/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-muted-foreground">
                          {t(`profileFields.${String(field.key)}.label`)}
                        </span>
                        <span
                          className={`mt-0.5 block text-sm ${shown ? "" : "text-muted-foreground"}`}
                        >
                          {shown ?? t("perfil.empty")}
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
