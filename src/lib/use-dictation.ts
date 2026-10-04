import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";

import { fetchProfile } from "@/lib/daily";
import { dictationLang } from "@/lib/i18n";

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
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
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
 * ¿Se puede abrir el micrófono en paralelo solo para medir el volumen? En
 * escritorio sí. En móvil (Android, iOS) el micro lo usa UNA cosa a la vez: una
 * segunda captura deja sin audio al reconocedor y el dictado no escribe nada.
 */
const canMeter = () => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  const iPad = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  return !iPad && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
};

/** Solo con el permiso ya dado: pedirlo aquí sería un segundo aviso junto al del dictado. */
const micGranted = async () => {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
};

/**
 * Mide el volumen del micrófono (RMS de la onda, 0..1) y lo deja en `level`.
 * La Web Speech API no lo da, así que es una captura aparte que no graba ni
 * envía nada: solo alimenta la onda (`DictationWave`).
 */
function startMeter(level: { current: number }): () => void {
  let stopped = false;
  let frame = 0;
  let stream: MediaStream | undefined;
  let audio: AudioContext | undefined;
  void (async () => {
    if (!(await micGranted()) || stopped) return;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (stopped) return stream.getTracks().forEach((track) => track.stop());
    audio = new AudioContext();
    // Nace suspendido si el navegador no cuenta el pulsado como gesto.
    void audio.resume();
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      // Una voz normal ronda 0,1-0,25 de RMS: ×4 la lleva a la escala 0..1.
      level.current = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      frame = requestAnimationFrame(tick);
    };
    tick();
  })().catch((error) => console.warn("dictado: medir el nivel de voz", error));
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    void audio?.close();
  };
}

/**
 * Dictado por voz de "mantener pulsado": usa el reconocimiento de voz nativo
 * del navegador (Web Speech API), no un servicio propio — así no dependemos
 * de ningún proveedor de pago ni gateway externo. `start()` en pointerdown,
 * `stop()` en pointerup/pointercancel. Cada frase que el reconocedor da por
 * terminada (`isFinal`) se añade con `onText`; las pausas intermedias no
 * cortan la escucha porque se pide reconocimiento continuo.
 *
 * `level` es el volumen de la voz (0..1) mientras se escucha, en un ref y no en
 * estado: cambia 60 veces por segundo y solo lo lee la onda. Donde no se puede
 * medir (`canMeter`), sube y baja con lo que el reconocedor dice oír
 * (`onspeechstart`/`onspeechend`): menos fino, pero sigue siendo una señal real.
 */
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const level = useRef(0);
  const stopLevelRef = useRef<(() => void) | null>(null);
  const supported = useMemo(() => getSpeechRecognitionCtor() !== null, []);
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const lang = dictationLang(profile?.locale, profile?.country);

  const start = useCallback(() => {
    if (recognitionRef.current) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = lang;
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
      stopLevelRef.current?.();
      stopLevelRef.current = null;
      level.current = 0;
      setState("idle");
    };

    if (canMeter()) {
      stopLevelRef.current = startMeter(level);
    } else {
      let speaking = false;
      recognition.onspeechstart = () => (speaking = true);
      recognition.onspeechend = () => (speaking = false);
      const timer = setInterval(() => {
        level.current = speaking ? 0.35 + Math.random() * 0.45 : 0.04;
      }, 90);
      stopLevelRef.current = () => clearInterval(timer);
    }

    recognitionRef.current = recognition;
    setState("listening");
    recognition.start();
  }, [lang, onText]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { state, supported, start, stop, level };
}
