import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { Check, ExternalLink, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { fetchProfile, saveProfile } from "../lib/daily";
import {
  healthConsentPatch,
  healthWithdrawalPatch,
  needsHealthConsent,
} from "../lib/health-consent";
import { Sheet } from "./ui/sheet";

/**
 * Consentimiento explícito para los datos de salud (ticket 30 de la auditoría,
 * RGPD art. 9.2.a). El mismo texto en los tres sitios donde se pide: el paso del
 * onboarding (antes de cualquier pregunta de salud), la hoja para las cuentas
 * que ya guardaban datos de salud y el interruptor de Ajustes › Privacidad.
 * Copia de `src/components/health-consent.tsx` de la web.
 *
 * La casilla empieza sin marcar y solo con ella se activa «Aceptar». Un solo
 * naranja por pantalla: la casilla marcada es grafito, no naranja.
 */

export const PRIVACY_URL = "https://www.peppersfam.es/privacidad";

export const openPrivacyPolicy = () =>
  WebBrowser.openBrowserAsync(PRIVACY_URL).catch((error) =>
    console.warn("privacidad: abrir la política", error),
  );

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
}: {
  mode: Mode;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(false);
  const canAccept = checked && !busy;

  return (
    <View>
      <ShieldCheck size={30} color="#a84a17" />
      <Text className="mt-4 font-heading text-3xl text-foreground">{t("healthConsent.title")}</Text>
      <Text className="mt-2 font-body text-sm leading-relaxed text-muted-foreground">
        {t(INTRO_KEY[mode])}
      </Text>

      <View className="mt-6 gap-4 rounded-[20px] bg-surface p-[18px]">
        {ITEMS.map((item) => (
          <View key={item}>
            <Text className="font-mono-medium text-[10px] uppercase tracking-wider text-muted-foreground">
              {t(`healthConsent.${item}.label`)}
            </Text>
            <Text className="mt-1 font-body text-[13px] leading-5 text-foreground">
              {t(`healthConsent.${item}.text`)}
            </Text>
          </View>
        ))}
      </View>

      <Pressable
        accessibilityRole="link"
        onPress={() => void openPrivacyPolicy()}
        hitSlop={8}
        className="mt-4 flex-row items-center gap-1.5 self-start active:opacity-70"
      >
        <Text className="font-body-medium text-sm text-primary-ink">
          {t("healthConsent.policy")}
        </Text>
        <ExternalLink size={14} color="#a84a17" />
      </Pressable>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => setChecked((c) => !c)}
        className="mt-6 flex-row items-start gap-3 rounded-2xl bg-surface p-4 active:opacity-80"
      >
        <View
          className={`mt-0.5 h-[22px] w-[22px] items-center justify-center rounded-[6px] ${
            checked ? "bg-foreground" : "bg-secondary"
          }`}
        >
          {checked ? <Check size={14} color="#fbfaf7" strokeWidth={2.6} /> : null}
        </View>
        <Text className="flex-1 font-body-medium text-sm leading-5 text-foreground">
          {t("healthConsent.checkbox")}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canAccept }}
        onPress={onAccept}
        disabled={!canAccept}
        className="mt-6 w-full flex-row items-center justify-center rounded-full bg-primary py-3.5 active:opacity-90"
        style={canAccept ? undefined : { opacity: 0.5 }}
      >
        {busy ? (
          <ActivityIndicator color="#3e3d39" />
        ) : (
          <Text className="font-body-semibold text-[13.5px] text-primary-foreground">
            {t("healthConsent.accept")}
          </Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onDecline}
        disabled={busy}
        className="mt-3 w-full items-center rounded-full bg-surface py-3.5 active:opacity-80"
      >
        <Text className="font-body-semibold text-[13.5px] text-muted-foreground">
          {t(DECLINE_KEY[mode])}
        </Text>
      </Pressable>
    </View>
  );
}

/** Guarda el consentimiento y refresca el perfil; avisa si no se pudo. */
function useSaveConsent() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const run = async (patch: Parameters<typeof saveProfile>[0]) => {
    setBusy(true);
    try {
      await saveProfile(patch);
      await qc.invalidateQueries({ queryKey: ["profile"] });
      // La guía y las cantidades del día dependen del perfil: que se rehagan.
      qc.removeQueries({ queryKey: ["today"] });
      return true;
    } catch (error) {
      console.warn("consentimiento: guardar", error);
      Alert.alert(t("healthConsent.saveError"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/**
 * Paso del onboarding, tras la portada. «Seguir sin datos de salud» avisa antes
 * de lo que el plan no podrá tener en cuenta (decisión del 2026-10-24).
 */
export function HealthConsentStep({
  onAccepted,
  onDeclined,
}: {
  /** Tras guardar el consentimiento (el perfil ya se ha releído). */
  onAccepted?: () => void;
  onDeclined: () => void;
}) {
  const { t } = useTranslation();
  const { busy, run } = useSaveConsent();

  const decline = () =>
    Alert.alert(t("healthConsent.declineWarning.title"), t("healthConsent.declineWarning.body"), [
      { text: t("healthConsent.declineWarning.back"), style: "cancel" },
      { text: t("healthConsent.declineWarning.confirm"), onPress: onDeclined },
    ]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-10 pt-8">
        <HealthConsentPanel
          mode="onboarding"
          busy={busy}
          onAccept={() => void run(healthConsentPatch()).then((ok) => ok && onAccepted?.())}
          onDecline={decline}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Para quien ya guardaba datos de salud sin consentimiento (o con el de un
 * texto anterior): una hoja a pantalla completa que no se cierra sin elegir.
 * «No acepto» borra esos datos. Va en el layout de `(app)`, así que sale en
 * cualquier pantalla; no en el onboarding, que tiene su propio paso.
 */
export function HealthConsentGate() {
  const { t } = useTranslation();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;
  const { busy, run } = useSaveConsent();
  const visible = !!profile?.onboarding_completed && needsHealthConsent(profile);

  const decline = () =>
    Alert.alert(t("healthConsent.deleteWarning.title"), t("healthConsent.deleteWarning.body"), [
      { text: t("healthConsent.declineWarning.back"), style: "cancel" },
      {
        text: t("healthConsent.deleteWarning.confirm"),
        style: "destructive",
        onPress: () => void run(healthWithdrawalPatch()),
      },
    ]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        /* no se cierra sin elegir */
      }}
    >
      <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
        <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-10 pt-8">
          <HealthConsentPanel
            mode="existing"
            busy={busy}
            onAccept={() => void run(healthConsentPatch())}
            onDecline={decline}
          />
        </ScrollView>
      </SafeAreaView>
    </Modal>
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
      <View className="pb-4 pt-6">
        <HealthConsentPanel
          mode="settings"
          busy={busy}
          onAccept={() => void run(healthConsentPatch()).then((ok) => ok && onOpenChange(false))}
          onDecline={() => onOpenChange(false)}
        />
      </View>
    </Sheet>
  );
}
