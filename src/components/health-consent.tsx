import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ExternalLink, ShieldCheck } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { fetchProfile, saveProfile, type Profile } from "@/lib/daily";
import {
  healthConsentPatch,
  healthWithdrawalPatch,
  needsHealthConsent,
} from "@/lib/health-consent";

/**
 * Consentimiento explícito para los datos de salud (ticket 30 de la auditoría,
 * RGPD art. 9.2.a). El mismo texto en los tres sitios donde se pide: el paso del
 * onboarding (antes de cualquier pregunta de salud), la hoja para las cuentas
 * que ya guardaban datos de salud y el interruptor de Ajustes › Privacidad.
 * Copia en `mobile/components/health-consent.tsx`.
 *
 * La casilla empieza sin marcar y solo con ella se activa «Aceptar». Un solo
 * naranja por pantalla: la casilla marcada es grafito, no naranja.
 */

type Mode = "onboarding" | "existing" | "settings";

const INTRO_KEY: Record<Mode, string> = {
  onboarding: "healthConsent.intro",
  existing: "healthConsent.introExisting",
  settings: "healthConsent.introSettings",
};

const DECLINE_KEY: Record<Mode, string> = {
  onboarding: "healthConsent.decline",
  existing: "healthConsent.declineExisting",
  settings: "healthConsent.declineSettings",
};

const ITEMS = ["what", "why", "who", "withdraw"] as const;

function HealthConsentPanel({
  mode,
  busy,
  onAccept,
  onDecline,
  renderTitle = (title) => (
    <h1 className="font-title text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
  ),
}: {
  mode: Mode;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  /** En una hoja, el título va dentro de su `SheetTitle` (accesibilidad de Radix). */
  renderTitle?: (title: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);
  const canAccept = checked && !busy;

  return (
    <div className="font-ui">
      <ShieldCheck className="h-8 w-8 text-primary-ink" aria-hidden />
      <div className="mt-4">{renderTitle(t("healthConsent.title"))}</div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(INTRO_KEY[mode])}</p>

      <dl className="mt-6 space-y-4 rounded-[20px] bg-surface p-[18px]">
        {ITEMS.map((item) => (
          <div key={item}>
            <dt className="font-num text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t(`healthConsent.${item}.label`)}
            </dt>
            <dd className="mt-1 text-[13px] leading-5 text-foreground">
              {t(`healthConsent.${item}.text`)}
            </dd>
          </div>
        ))}
      </dl>

      <Link
        to="/privacidad"
        target="_blank"
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-ink underline-offset-4 hover:underline"
      >
        {t("healthConsent.policy")}
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </Link>

      <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl bg-surface p-4">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring ${
            checked ? "bg-foreground" : "bg-secondary"
          }`}
        >
          {checked ? <Check className="h-3.5 w-3.5 text-surface" strokeWidth={2.6} /> : null}
        </span>
        <span className="text-sm font-medium leading-5 text-foreground">
          {t("healthConsent.checkbox")}
        </span>
      </label>

      <button
        type="button"
        onClick={onAccept}
        disabled={!canAccept}
        className="mt-6 flex w-full items-center justify-center rounded-full bg-primary py-3.5 text-[13.5px] font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? <Spinner /> : t("healthConsent.accept")}
      </button>
      <button
        type="button"
        onClick={onDecline}
        disabled={busy}
        className="mt-3 w-full rounded-full bg-surface py-3.5 text-[13.5px] font-semibold text-muted-foreground transition-colors hover:text-primary-ink disabled:opacity-60"
      >
        {t(DECLINE_KEY[mode])}
      </button>
    </div>
  );
}

/** Guarda el consentimiento y refresca el perfil; avisa si no se pudo. */
function useSaveConsent() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (patch: Partial<Profile>) => {
    setBusy(true);
    try {
      await saveProfile(patch);
      await qc.invalidateQueries({ queryKey: ["profile"] });
      // La guía y las cantidades del día dependen del perfil: que se rehagan.
      qc.removeQueries({ queryKey: ["today"] });
      return true;
    } catch (error) {
      console.warn("consentimiento: guardar", error);
      toast.error(t("healthConsent.saveError"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Confirmación de un rechazo: lo que el plan no podrá tener en cuenta, o lo que se borra. */
function DeclineDialog({
  open,
  onOpenChange,
  kind,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: "declineWarning" | "deleteWarning";
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`healthConsent.${kind}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`healthConsent.${kind}.body`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("healthConsent.declineWarning.back")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={
              kind === "deleteWarning"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {t(`healthConsent.${kind}.confirm`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Paso del onboarding, tras la portada. «Seguir sin datos de salud» avisa antes
 * de lo que el plan no podrá tener en cuenta (decisión del 2026-10-24). Aceptar
 * guarda el consentimiento en el perfil, y al releerlo salen las preguntas de salud.
 */
export function HealthConsentStep({ onDeclined }: { onDeclined: () => void }) {
  const { busy, run } = useSaveConsent();
  const [warning, setWarning] = useState(false);
  return (
    <main className="mx-auto max-w-lg px-5 pb-10 pt-10">
      <HealthConsentPanel
        mode="onboarding"
        busy={busy}
        onAccept={() => void run(healthConsentPatch())}
        onDecline={() => setWarning(true)}
      />
      <DeclineDialog
        open={warning}
        onOpenChange={setWarning}
        kind="declineWarning"
        onConfirm={onDeclined}
      />
    </main>
  );
}

const sheetTitle = (title: string) => (
  <SheetTitle className="font-title text-3xl font-semibold tracking-tight">{title}</SheetTitle>
);

/**
 * Para quien ya guardaba datos de salud sin consentimiento (o con el de un
 * texto anterior): una hoja que no se cierra sin elegir. «No acepto» borra esos
 * datos. Va en el layout autenticado, así que sale en cualquier pantalla; no en
 * el onboarding, que tiene su propio paso.
 */
export function HealthConsentGate() {
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;
  const { busy, run } = useSaveConsent();
  const [warning, setWarning] = useState(false);
  const open = !!profile?.onboarding_completed && needsHealthConsent(profile);
  const keepOpen = (e: Event) => e.preventDefault();

  return (
    <Sheet open={open}>
      <SheetContent
        side="bottom"
        hideClose
        aria-describedby={undefined}
        onEscapeKeyDown={keepOpen}
        onPointerDownOutside={keepOpen}
        onInteractOutside={keepOpen}
        className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto"
      >
        <HealthConsentPanel
          mode="existing"
          busy={busy}
          onAccept={() => void run(healthConsentPatch())}
          onDecline={() => setWarning(true)}
          renderTitle={sheetTitle}
        />
        <DeclineDialog
          open={warning}
          onOpenChange={setWarning}
          kind="deleteWarning"
          onConfirm={() => void run(healthWithdrawalPatch())}
        />
      </SheetContent>
    </Sheet>
  );
}

/** Al encender «Usar mis datos de salud» en Ajustes: se puede cerrar sin elegir. */
export function HealthConsentSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { busy, run } = useSaveConsent();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        aria-describedby={undefined}
        className="mx-auto max-h-[92dvh] max-w-lg overflow-y-auto"
      >
        <HealthConsentPanel
          mode="settings"
          busy={busy}
          onAccept={() => void run(healthConsentPatch()).then((ok) => ok && onOpenChange(false))}
          onDecline={() => onOpenChange(false)}
          renderTitle={sheetTitle}
        />
      </SheetContent>
    </Sheet>
  );
}
