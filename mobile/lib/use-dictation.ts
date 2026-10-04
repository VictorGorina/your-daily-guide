import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";

import { fetchProfile } from "./daily";
import { dictationLang } from "./i18n";

export type DictationState = "idle" | "listening";

/**
 * Dictado por voz de "mantener pulsado": usa el reconocimiento de voz nativo
 * del dispositivo (Speech framework de Apple vía expo-speech-recognition), no
 * un servicio propio — así no dependemos de ningún proveedor de pago ni
 * gateway externo. `start()` en pointerdown/pressIn, `stop()` en
 * pointerup/pressOut. Cada frase que el reconocedor da por terminada
 * (`isFinal`) se añade con `onText`; las pausas intermedias no cortan la
 * escucha porque se pide `continuous: true`.
 */
/**
 * Vibración corta al empezar y al acabar de dictar. `expo-haptics` es un módulo
 * nativo: en un build anterior a su prebuild no está y la llamada falla, así
 * que se avisa una vez y el dictado sigue (ver AGENTS.md).
 */
let hapticsWarned = false;
const haptic = (strength: "start" | "end") => {
  import("expo-haptics")
    .then((Haptics) =>
      Haptics.impactAsync(
        strength === "start"
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light,
      ),
    )
    .catch((error) => {
      if (hapticsWarned) return;
      hapticsWarned = true;
      console.warn("dictado: respuesta háptica", error);
    });
};

/** Cada cuánto manda el reconocedor el volumen de la voz (`volumechange`). */
const VOLUME_INTERVAL_MS = 70;

export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const activeRef = useRef(false);
  // Volumen de la voz (0..1) mientras se escucha. En un ref y no en estado:
  // cambia muchas veces por segundo y solo lo lee la onda (`DictationWave`).
  const level = useRef(0);
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const lang = dictationLang(profile?.locale, profile?.country);

  useSpeechRecognitionEvent("result", (event) => {
    if (!activeRef.current || !event.isFinal) return;
    const text = event.results[0]?.transcript?.trim();
    if (text) onText(text);
  });

  // De -2 a 10, y por debajo de 0 no se oye nada.
  useSpeechRecognitionEvent("volumechange", (event) => {
    if (activeRef.current) level.current = Math.min(1, Math.max(0, event.value / 8));
  });

  useSpeechRecognitionEvent("end", () => {
    // Otro `DictateButton` montado recibe el mismo evento: solo vibra el que dictaba.
    if (activeRef.current) haptic("end");
    activeRef.current = false;
    level.current = 0;
    setState("idle");
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "no-speech" || event.error === "aborted") return;
    Alert.alert(
      "No se pudo dictar",
      "Revisa que Peppers tenga permiso de micrófono y reconocimiento de voz en Ajustes.",
    );
  });

  const start = useCallback(async () => {
    if (activeRef.current) return;
    // Antes de abrir el micrófono: iOS apaga la vibración mientras se graba.
    haptic("start");
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Micrófono desactivado",
        "Activa el micrófono y el reconocimiento de voz para Peppers en Ajustes para poder dictar.",
      );
      return;
    }
    activeRef.current = true;
    setState("listening");
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: false,
      continuous: true,
      volumeChangeEventOptions: { enabled: true, intervalMillis: VOLUME_INTERVAL_MS },
    });
  }, [lang]);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return { state, start, stop, level };
}
