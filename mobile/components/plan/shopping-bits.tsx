import { Carrot, Egg, Fish, Wheat } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Animated } from "react-native";

import type { PlanCoverage, ShoppingItem } from "../../lib/plan-shared";

/** Una compra ya proyectada (`projectTrips`): sus ingredientes por categoría. */
export type TripGroups = { trip: number; groups: { category: string; items: ShoppingItem[] }[] };

export const FULL_COVERAGE: PlanCoverage = { fromDay: 1, toDay: 31 };

// ---------------------------------------------------------------------------
// Icono por categoría de supermercado. Las categorías las escribe la IA como
// texto libre ("Frutas y verduras", "Pescado y carne"...), así que el match es
// por palabra clave, no por nombre exacto.
// ---------------------------------------------------------------------------
const CATEGORY_MATCHERS: [RegExp, typeof Carrot][] = [
  [/verdura|fruta|hortaliza/i, Carrot],
  [/pescado|carne|proteín|pollo|ternera/i, Fish],
  [/despensa|conserva|cereal|legumbre|pasta|arroz|aceite/i, Wheat],
  [/lácteo|huevo|leche|yogur|queso/i, Egg],
];

export function CategoryIcon({
  category,
  size = 15,
  color = "#a84a17",
}: {
  category: string;
  size?: number;
  color?: string;
}) {
  const match = CATEGORY_MATCHERS.find(([re]) => re.test(category));
  if (!match) return null;
  const Icon = match[1];
  return <Icon size={size} color={color} />;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));

// Relleno de barra de progreso que anima su ancho al cambiar, para igualar la
// transición `duration-500` de la web (React Native no anima cambios de estilo
// por sí solo). `Animated` clásico basta: nada de anchura por native driver.
export function ProgressFill({
  pct,
  color,
  rounded,
}: {
  pct: number;
  color: string;
  rounded?: boolean;
}) {
  const target = clampPct(pct);
  const w = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: target, duration: 500, useNativeDriver: false }).start();
  }, [target, w]);
  return (
    <Animated.View
      style={{
        height: "100%",
        backgroundColor: color,
        borderRadius: rounded ? 999 : 0,
        width: w.interpolate({ inputRange: [0, 100], outputRange: ["0%", "100%"] }),
      }}
    />
  );
}
