import { authHeaders } from "@/lib/auth-headers";
import { useCallback, useRef, useState } from "react";

type Recorder = {
  stop: () => Promise<Blob>;
};

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const target = 16000;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }

  const ratio = sampleRate / target;
  const length = Math.floor(total / ratio);
  const samples = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    const v = merged[Math.floor(i * ratio)] ?? 0;
    const clamped = Math.max(-1, Math.min(1, v));
    samples[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, target, true);
  view.setUint32(28, target * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  new Int16Array(buffer, 44).set(samples);

  return new Blob([buffer], { type: "audio/wav" });
}

async function startRecorder(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(ctx.destination);

  return {
    stop: async () => {
      stream.getTracks().forEach((t) => t.stop());
      node.disconnect();
      source.disconnect();
      const blob = encodeWav(chunks, ctx.sampleRate);
      await ctx.close();
      return blob;
    },
  };
}

export type DictationState = "idle" | "recording" | "transcribing";

export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<DictationState>("idle");
  const recorderRef = useRef<Recorder | null>(null);
  // Bloquea toques repetidos mientras arranca/para la grabación: sin esto, un doble
  // toque rápido antes de que `state` se actualice puede abrir dos grabaciones a la
  // vez y dejar la primera (micrófono + AudioContext) sin cerrar nunca.
  const busyRef = useRef(false);

  const toggle = useCallback(async () => {
    if (state === "transcribing" || busyRef.current) return;
    busyRef.current = true;

    if (state === "idle") {
      try {
        recorderRef.current = await startRecorder();
        setState("recording");
      } catch {
        throw new Error("Necesitamos permiso para usar el micrófono");
      } finally {
        busyRef.current = false;
      }
      return;
    }

    const recorder = recorderRef.current;
    recorderRef.current = null;
    setState("transcribing");
    try {
      const blob = await recorder!.stop();
      if (blob.size < 2048) throw new Error("No hemos oído nada, inténtalo otra vez");

      const form = new FormData();
      form.append("audio", blob, "recording.wav");
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: await authHeaders(),
        body: form,
      });
      if (!res.ok) throw new Error("No hemos podido transcribir el audio");
      const data = (await res.json()) as { text?: string };
      const text = (data.text ?? "").trim();
      if (text) onText(text);
    } finally {
      setState("idle");
      busyRef.current = false;
    }
  }, [state, onText]);

  return { state, toggle };
}
