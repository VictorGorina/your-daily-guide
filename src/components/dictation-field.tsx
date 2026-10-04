import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { DictationContext, useDictationField } from "@/lib/dictation-context";
import { cn } from "@/lib/utils";

/**
 * Un campo de texto con dictado. Envuelve el campo y su `DictateButton`: se
 * dicta siempre SOBRE un campo, para que la persona vea y corrija lo que se ha
 * entendido antes de enviarlo. Dentro, `DictationWave` cubre el campo con la
 * onda de la voz mientras se mantiene pulsado el botón.
 *
 * No pinta nada por sí mismo: cada pantalla conserva su marcado.
 */
export function DictationField({ children }: { children: ReactNode }) {
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState<RefObject<number> | null>(null);
  const report = useCallback((next: boolean, source: RefObject<number>) => {
    setListening(next);
    setLevel(source);
  }, []);
  const value = useMemo(() => ({ listening, level, report }), [listening, level, report]);
  return <DictationContext.Provider value={value}>{children}</DictationContext.Provider>;
}

const BAR_WIDTH = 3;
const BAR_GAP = 3;
/** Cada cuánto entra una barra nueva por la derecha. */
const STEP_MS = 55;

/**
 * La onda de la voz sobre el campo: una barra por instante, las nuevas entran
 * por la derecha con la altura del volumen de ese momento. No es un adorno en
 * bucle (guía de diseño §7): solo existe mientras se dicta y cada barra es un
 * dato, la prueba de que el micrófono oye. Con "reducir movimiento" las barras
 * no se desplazan: una sola fila que sube y baja en el sitio.
 *
 * Va dentro de un contenedor `relative` que rodee al campo; `className` ajusta
 * hasta dónde llega (p. ej. para no tapar los botones de debajo).
 */
export function DictationWave({ className }: { className?: string }) {
  const field = useDictationField();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const listening = field?.listening ?? false;
  const level = field?.level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!listening || !canvas || !level) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);
    context.fillStyle = getComputedStyle(canvas).color;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const count = Math.max(1, Math.floor((width + BAR_GAP) / (BAR_WIDTH + BAR_GAP)));
    const offset = (width - count * (BAR_WIDTH + BAR_GAP) + BAR_GAP) / 2;
    const bars = new Array<number>(count).fill(0);
    const maxBar = Math.min(height - 12, 44);
    let frame = 0;
    let last = 0;
    let smooth = 0;

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      // Sube deprisa y baja despacio, como un vúmetro: sin esto la onda tiembla.
      const current = level.current ?? 0;
      smooth = current > smooth ? current : smooth * 0.9 + current * 0.1;
      if (now - last < STEP_MS) return;
      last = now;
      if (still) bars.fill(smooth);
      else {
        bars.shift();
        bars.push(smooth);
      }
      context.clearRect(0, 0, width, height);
      bars.forEach((bar, i) => {
        const h = Math.max(BAR_WIDTH, bar * maxBar);
        context.beginPath();
        context.roundRect(
          offset + i * (BAR_WIDTH + BAR_GAP),
          (height - h) / 2,
          BAR_WIDTH,
          h,
          BAR_WIDTH / 2,
        );
        context.fill();
      });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [listening, level]);

  if (!listening) return null;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-[5] flex items-center rounded-[inherit] bg-background/55 px-3 backdrop-blur-md",
        className,
      )}
    >
      <canvas ref={canvasRef} className="h-full w-full text-foreground" />
    </div>
  );
}
