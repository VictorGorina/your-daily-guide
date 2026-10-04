import { type ReactNode, type RefObject, useCallback, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Animated, View } from "react-native";

import { DictationContext, useDictationField } from "../lib/dictation-context";

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

const BARS = 34;
const BAR_HEIGHT = 34;
/** Cada cuánto entra una barra nueva por la derecha. */
const STEP_MS = 70;

/**
 * La onda de la voz sobre el campo: una barra por instante, las nuevas entran
 * por la derecha con la altura del volumen de ese momento. Solo existe mientras
 * se dicta y cada barra es un dato, la prueba de que el micrófono oye. Con
 * "reducir movimiento" las barras no se desplazan: suben y bajan en el sitio.
 *
 * Va dentro de una `View` con `relative` que rodee al campo. React Native no
 * desenfoca lo de debajo como la web, así que el fondo es opaco: `className`
 * lleva el color del campo que tapa (`bg-surface`, `bg-muted`…).
 */
export function DictationWave({ className = "bg-surface" }: { className?: string }) {
  const field = useDictationField();
  const listening = field?.listening ?? false;
  const level = field?.level;
  // Animated clásico, como `ProgressFill` de Plan: reanimated está sin configurar.
  const [bars] = useState(() => Array.from({ length: BARS }, () => new Animated.Value(0)));

  useEffect(() => {
    if (!listening || !level) return;
    let still = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => (still = reduce))
      .catch((error) => console.warn("dictado: leer reducir movimiento", error));
    const heights = new Array<number>(BARS).fill(0);
    let smooth = 0;
    const timer = setInterval(() => {
      // Sube deprisa y baja despacio, como un vúmetro: sin esto la onda tiembla.
      const current = level.current ?? 0;
      smooth = current > smooth ? current : smooth * 0.75 + current * 0.25;
      if (still) heights.fill(smooth);
      else {
        heights.shift();
        heights.push(smooth);
      }
      heights.forEach((height, i) => bars[i]!.setValue(Math.max(0.09, height)));
    }, STEP_MS);
    return () => {
      clearInterval(timer);
      bars.forEach((bar) => bar.setValue(0));
    };
  }, [listening, level, bars]);

  if (!listening) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`absolute inset-0 flex-row items-center justify-center gap-[3px] overflow-hidden rounded-3xl ${className}`}
    >
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={{
            width: 3,
            height: BAR_HEIGHT,
            borderRadius: 1.5,
            backgroundColor: "#3e3d39",
            transform: [{ scaleY: bar }],
          }}
        />
      ))}
    </View>
  );
}
