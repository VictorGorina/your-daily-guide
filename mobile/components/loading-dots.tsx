import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";

/**
 * Tres puntos que suben y bajan: «estoy trabajando» (el precalentado de Plan).
 * Decorativos: el texto de al lado es el que dice qué pasa. Mismo ritmo que
 * `animate-coach-dot` de la web (`src/components/loading-dots.tsx`): 1,4 s por
 * vuelta, arriba a los 0,56 s, cada punto 0,15 s detrás del anterior. Con
 * reducir movimiento se quedan quietos.
 *
 * `Animated` clásico, como la onda del dictado: reanimated está sin configurar.
 * El color va en un `View` de dentro con `className`, así sigue el tema.
 */

const PERIOD_MS = 1400;
const RISE_MS = 560;
const STAGGER_MS = 150;
const DOTS = [
  { className: "bg-primary" },
  { className: "bg-primary/70" },
  { className: "bg-primary/50" },
];

export function LoadingDots({ small = false }: { small?: boolean }) {
  const [still, setStill] = useState(false);
  const [lifts] = useState(() => DOTS.map(() => new Animated.Value(0)));

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => alive && setStill(reduce))
      .catch((error) => console.warn("puntos de carga: leer reducir movimiento", error));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (still) return;
    const ease = Easing.inOut(Easing.ease);
    const loops = lifts.map((lift, i) =>
      Animated.sequence([
        Animated.delay(i * STAGGER_MS),
        Animated.loop(
          Animated.sequence([
            Animated.timing(lift, {
              toValue: 1,
              duration: RISE_MS,
              easing: ease,
              useNativeDriver: true,
            }),
            Animated.timing(lift, {
              toValue: 0,
              duration: RISE_MS,
              easing: ease,
              useNativeDriver: true,
            }),
            Animated.delay(PERIOD_MS - 2 * RISE_MS),
          ]),
        ),
      ]),
    );
    loops.forEach((loop) => loop.start());
    return () => {
      loops.forEach((loop) => loop.stop());
      lifts.forEach((lift) => lift.setValue(0));
    };
  }, [still, lifts]);

  const size = small ? 6 : 8;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={small ? "flex-row items-center gap-0.5" : "flex-row items-center gap-1"}
    >
      {DOTS.map((dot, i) => (
        <Animated.View
          key={dot.className}
          style={
            still
              ? undefined
              : {
                  opacity: lifts[i]!.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
                  transform: [
                    {
                      translateY: lifts[i]!.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -4],
                      }),
                    },
                  ],
                }
          }
        >
          <View className={`rounded-full ${dot.className}`} style={{ width: size, height: size }} />
        </Animated.View>
      ))}
    </View>
  );
}
