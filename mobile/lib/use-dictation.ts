import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";

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
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const activeRef = useRef(false);

  useSpeechRecognitionEvent("result", (event) => {
    if (!activeRef.current || !event.isFinal) return;
    const text = event.results[0]?.transcript?.trim();
    if (text) onText(text);
  });

  useSpeechRecognitionEvent("end", () => {
    activeRef.current = false;
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
    ExpoSpeechRecognitionModule.start({ lang: "es-ES", interimResults: false, continuous: true });
  }, []);

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    ExpoSpeechRecognitionModule.stop();
  }, []);

  return { state, start, stop };
}
