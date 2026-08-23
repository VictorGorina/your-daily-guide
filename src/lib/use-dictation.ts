import { useCallback, useMemo, useRef, useState } from "react";

export type DictationState = "idle" | "listening";

// La Web Speech API no forma parte de lib.dom.d.ts (no es un estándar, solo la
// implementan Chrome/Edge/Safari con prefijo webkit); se tipa aquí, local a
// este módulo, en vez de añadir una declaración global .d.ts para un único uso.
type SpeechRecognitionResultLike = {
  isFinal: boolean;
  [index: number]: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Dictado por voz de "mantener pulsado": usa el reconocimiento de voz nativo
 * del navegador (Web Speech API), no un servicio propio — así no dependemos
 * de ningún proveedor de pago ni gateway externo. `start()` en pointerdown,
 * `stop()` en pointerup/pointercancel. Cada frase que el reconocedor da por
 * terminada (`isFinal`) se añade con `onText`; las pausas intermedias no
 * cortan la escucha porque se pide reconocimiento continuo.
 */
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = useMemo(() => getSpeechRecognitionCtor() !== null, []);

  const start = useCallback(() => {
    if (recognitionRef.current) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = "es-ES";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) {
          const text = result[0]?.transcript.trim();
          if (text) onText(text);
        }
      }
    };
    // "no-speech"/"aborted" son normales al soltar sin haber hablado o al
    // cortar antes de que arranque; el resto de errores (permiso denegado,
    // sin red...) ya se reflejan en que no llegue ningún texto.
    recognition.onerror = () => {};
    recognition.onend = () => {
      recognitionRef.current = null;
      setState("idle");
    };

    recognitionRef.current = recognition;
    setState("listening");
    recognition.start();
  }, [onText]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { state, supported, start, stop };
}
