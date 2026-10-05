import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertCircle, ChevronRight, Download, Info, Pencil, Users } from "lucide-react";
import * as React from "react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { BottomNav } from "@/components/bottom-nav";
import { RegionFields } from "@/components/region-fields";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { deleteAccount } from "@/lib/account.functions";
import { fetchAllLogs, fetchProfile, saveProfile, todayISO, type Profile } from "@/lib/daily";
import { buildHistoryCsv, historyFileName } from "@/lib/history-export";
import { clearLocalUserData } from "@/lib/local-user-data";
import { showsNutritionNumbers } from "@/lib/macros";
import {
  getPushSubscriptionState,
  isIosNonStandalone,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";
import { currencyForCountry, DEFAULT_COUNTRY } from "@/lib/regions";
import { applyTheme, THEMES } from "@/lib/theme";
import { useLocale } from "@/lib/use-locale";
import { resolveDeviceTimeZone } from "@/lib/zoned-date";

function FieldNote({ error, help }: { error?: string; help: string }) {
  if (error)
    return (
      <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {error}
      </p>
    );
  return <p className="mt-1 text-[11px] text-muted-foreground">{help}</p>;
}

// Campo con la etiqueta siempre visible encima del valor (en vez de un
// placeholder que desaparece al escribir), para que un dato ya rellenado
// ("78" de peso) se siga leyendo con contexto.
function FieldInput({
  label,
  className,
  ...props
}: { label: string } & React.ComponentProps<"input">) {
  // La etiqueta visible es también el nombre del campo para el lector de pantalla.
  const id = useId();
  return (
    <div className="rounded-2xl bg-muted px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-ring/40">
      <label
        htmlFor={id}
        className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      <input
        id={id}
        {...props}
        className={`mt-0.5 w-full bg-transparent text-sm font-medium text-foreground outline-none ${className ?? ""}`}
      />
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/ajustes")({
  component: Ajustes,
});

function Ajustes() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;
  const { locale, setLocale } = useLocale();

  const save = useMutation({
    mutationFn: (patch: Partial<Profile>) => saveProfile(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
    onError: () => toast.error(t("common.saveError")),
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const pushSupported = isPushSupported();
  const iosHint = isIosNonStandalone();

  useEffect(() => {
    if (!pushSupported) return;
    getPushSubscriptionState().then((state) => setPushEnabled(state === "subscribed"));
  }, [pushSupported]);

  const togglePush = async (next: boolean) => {
    setPushBusy(true);
    try {
      if (next) {
        await subscribeToPush();
        setPushEnabled(true);
      } else {
        await unsubscribeFromPush();
        setPushEnabled(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ajustes.push.toggleError"));
    } finally {
      setPushBusy(false);
    }
  };

  const setError = (key: string, message?: string) =>
    setErrors((e) => {
      const next = { ...e };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  const commitNumber = (
    key: "current_weight_kg" | "height_cm" | "target_weight_kg",
    raw: string,
    min: number,
    max: number,
    message: string,
    required: boolean,
  ) => {
    const text = raw.trim();
    if (!text) {
      if (required) {
        setError(key, t("ajustes.errors.required"));
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
      setError(key, t("ajustes.errors.time"));
      return;
    }
    setError(key);
    save.mutate({ [key]: raw } as Partial<Profile>);
  };

  const missing = [
    profile && !profile.current_weight_kg ? t("ajustes.missing.weight") : null,
    profile && !profile.height_cm ? t("ajustes.missing.height") : null,
    profile && !profile.morning_time ? t("ajustes.missing.morning") : null,
    profile && !profile.evening_time ? t("ajustes.missing.evening") : null,
  ].filter(Boolean) as string[];

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  // El historial se arma en el navegador con lo que la persona ya puede leer
  // (RLS: solo sus filas); ver `buildHistoryCsv`.
  const [exporting, setExporting] = useState(false);
  const exportHistory = async () => {
    setExporting(true);
    try {
      const logs = await fetchAllLogs();
      if (!logs.length) {
        toast.info(t("ajustes.history.empty"));
        return;
      }
      const csv = buildHistoryCsv(logs, { numbers: showsNutritionNumbers(profile) });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = historyFileName(todayISO());
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn("ajustes: exportar el historial", error);
      toast.error(t("ajustes.history.error"));
    } finally {
      setExporting(false);
    }
  };

  const callDeleteAccount = useServerFn(deleteAccount);
  const [deleting, setDeleting] = useState(false);

  const removeAccount = async () => {
    setDeleting(true);
    try {
      await callDeleteAccount();
      await qc.cancelQueries();
      qc.clear();
      // También lo hace el listener de sesión con SIGNED_OUT; aquí, por si no llega.
      clearLocalUserData();
      await supabase.auth.signOut();
      toast.success(t("ajustes.deleteAccount.done"));
      navigate({ to: "/", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("ajustes.deleteAccount.error"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-lg px-5 pb-28 pt-12">
      <h1 className="font-title text-[34px] font-semibold tracking-[-0.03em]">
        {t("ajustes.title")}
      </h1>

      {missing.length ? (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-primary-soft px-4 py-3 text-xs">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" />
          <span>{t("ajustes.missing.text", { list: missing.join(", ") })}</span>
        </div>
      ) : null}

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("ajustes.sections.account")}
      </span>
      <div className="surface-card mt-2 divide-y divide-border overflow-hidden">
        <Link to="/hogar" className="flex items-center gap-3 px-4 py-4 text-sm">
          <Users className="h-4 w-4 shrink-0 text-primary-ink" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("ajustes.home.title")}</span>
            <span className="block text-xs text-muted-foreground">{t("ajustes.home.desc")}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
        <Link to="/perfil" className="flex items-center gap-3 px-4 py-4 text-sm">
          <Pencil className="h-4 w-4 shrink-0 text-primary-ink" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("ajustes.answers.title")}</span>
            <span className="block text-xs text-muted-foreground">{t("ajustes.answers.desc")}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </div>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("ajustes.sections.profile")}
      </span>
      <section className="surface-card mt-2 space-y-4 p-5">
        <h2 className="text-sm font-semibold">{t("ajustes.basics.title")}</h2>
        <FieldInput
          label={t("ajustes.basics.name")}
          defaultValue={profile?.display_name ?? ""}
          placeholder="—"
          onBlur={(e) => save.mutate({ display_name: e.target.value || null })}
        />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldInput
              label={t("ajustes.basics.weight")}
              inputMode="decimal"
              defaultValue={profile?.current_weight_kg ?? ""}
              placeholder="kg"
              onBlur={(e) =>
                commitNumber(
                  "current_weight_kg",
                  e.target.value,
                  25,
                  350,
                  t("ajustes.errors.weight"),
                  true,
                )
              }
            />
            <FieldNote error={errors["current_weight_kg"]} help={t("ajustes.basics.weightHelp")} />
          </div>
          <div>
            <FieldInput
              label={t("ajustes.basics.height")}
              inputMode="decimal"
              defaultValue={profile?.height_cm ?? ""}
              placeholder="cm"
              onBlur={(e) =>
                commitNumber(
                  "height_cm",
                  e.target.value,
                  100,
                  250,
                  t("ajustes.errors.height"),
                  true,
                )
              }
            />
            <FieldNote error={errors["height_cm"]} help={t("ajustes.basics.heightHelp")} />
          </div>
        </div>
        <div>
          <FieldInput
            label={t("ajustes.basics.targetWeight")}
            inputMode="decimal"
            defaultValue={profile?.target_weight_kg ?? ""}
            placeholder="kg"
            onBlur={(e) =>
              commitNumber(
                "target_weight_kg",
                e.target.value,
                30,
                300,
                t("ajustes.errors.targetWeight"),
                false,
              )
            }
          />
          <FieldNote error={errors["target_weight_kg"]} help={t("ajustes.basics.targetHelp")} />
        </div>
      </section>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("ajustes.sections.coach")}
      </span>
      <section className="surface-card mt-2 divide-y divide-border p-5">
        <div>
          <h2 className="text-sm font-semibold">{t("ajustes.tone.title")}</h2>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {["relajado", "neutro", "exigente"].map((tone) => (
              <button
                key={tone}
                onClick={() => save.mutate({ tone })}
                className={`rounded-2xl px-3 py-3 text-sm capitalize transition-colors ${
                  profile?.tone === tone ? "bg-foreground text-background" : "bg-secondary"
                }`}
              >
                {t(`ajustes.tone.${tone}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4">
          <h2 className="text-sm font-semibold">{t("ajustes.reminders.title")}</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <FieldInput
                label={t("ajustes.reminders.morning")}
                type="time"
                defaultValue={profile?.morning_time?.slice(0, 5) ?? "08:00"}
                onBlur={(e) => commitTime("morning_time", e.target.value)}
              />
              <FieldNote error={errors["morning_time"]} help={t("ajustes.reminders.morningHelp")} />
            </div>
            <div>
              <FieldInput
                label={t("ajustes.reminders.evening")}
                type="time"
                defaultValue={profile?.evening_time?.slice(0, 5) ?? "21:30"}
                onBlur={(e) => commitTime("evening_time", e.target.value)}
              />
              <FieldNote error={errors["evening_time"]} help={t("ajustes.reminders.eveningHelp")} />
            </div>
          </div>
        </div>
      </section>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("ajustes.sections.notifications")}
      </span>
      <section className="surface-card mt-2 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("ajustes.push.title")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("ajustes.push.desc")}</p>
          </div>
          <Switch
            checked={pushEnabled}
            disabled={pushBusy || !pushSupported}
            onCheckedChange={(v) => void togglePush(v)}
          />
        </div>
        {!pushSupported ? (
          <FieldNote help={t("ajustes.push.unsupported")} />
        ) : iosHint ? (
          <FieldNote help={t("ajustes.push.iosHint")} />
        ) : null}
      </section>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("region.settingsTitle")}
      </span>
      <section className="surface-card mt-2 p-5">
        <p className="text-xs text-muted-foreground">{t("region.settingsSubtitle")}</p>
        <div className="mt-4">
          <RegionFields
            locale={locale}
            country={profile?.country ?? DEFAULT_COUNTRY.code}
            timezone={profile?.timezone ?? resolveDeviceTimeZone()}
            onLocaleChange={(next) => void setLocale(next)}
            onCountryChange={(code) =>
              save.mutate({ country: code, currency: currencyForCountry(code) })
            }
            onTimezoneChange={(tz) => save.mutate({ timezone: tz })}
          />
        </div>
      </section>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("ajustes.sections.appearance")}
      </span>
      <section className="surface-card mt-2 p-5">
        <h2 className="text-sm font-semibold">{t("ajustes.theme.title")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("ajustes.theme.desc")}</p>
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-secondary p-1">
          {THEMES.map((theme) => {
            const active = (profile?.theme ?? "claro") === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => {
                  applyTheme(theme.id);
                  save.mutate({ theme: theme.id });
                }}
                aria-pressed={active}
                className={`flex items-center justify-center gap-2 rounded-full py-2 text-xs font-semibold transition-colors ${
                  active ? "bg-background text-foreground" : "text-muted-foreground"
                }`}
              >
                <span
                  className="h-3.5 w-3.5 shrink-0 rounded-full"
                  style={{ backgroundColor: theme.swatch[2] }}
                />
                {t(`ajustes.theme.${theme.id}`)}
              </button>
            );
          })}
        </div>
      </section>

      <span className="mt-6 block px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("ajustes.sections.data")}
      </span>

      <div className="surface-card mt-2 p-5">
        <h2 className="text-sm font-semibold">{t("ajustes.history.title")}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("ajustes.history.desc")}
        </p>
        <button
          type="button"
          onClick={exportHistory}
          disabled={exporting}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-secondary py-3 text-sm font-medium text-foreground disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          {exporting ? t("ajustes.history.preparing") : t("ajustes.history.download")}
        </button>
      </div>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button className="mt-3 w-full rounded-full bg-surface py-4 text-sm font-medium text-muted-foreground">
            {t("ajustes.signOut.button")}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ajustes.signOut.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("ajustes.signOut.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={signOut}>{t("ajustes.signOut.button")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button className="mt-3 w-full rounded-full bg-destructive/10 py-4 text-sm font-medium text-destructive">
            {t("ajustes.deleteAccount.button")}
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ajustes.deleteAccount.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("ajustes.deleteAccount.desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeAccount}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t("ajustes.deleteAccount.deleting") : t("ajustes.deleteAccount.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BottomNav />
    </main>
  );
}
