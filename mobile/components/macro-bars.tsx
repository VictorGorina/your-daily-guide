import { Text, View } from "react-native";

import type { MacroEstimate } from "../lib/daily";
import { macroTargets } from "../lib/macros";

const MACRO_BAR_ITEMS = [
  { key: "protein_g", label: "prot", color: "#6DBE7B" },
  { key: "carbs_g", label: "carb", color: "#FF8A3D" },
  { key: "fat_g", label: "gras", color: "#F2C14E" },
  { key: "fiber_g", label: "fibra", color: "#4C9BD6" },
] as const;

/**
 * `target` es el `macroEstimate` del día cuando ya existe (se recalcula si un
 * plato cambia); solo cae al respaldo genérico por peso mientras aún no hay
 * guía. El porcentaje no se recorta a 100: si ya comiste de más la barra se
 * queda llena, pero el número de al lado enseña el exceso — solo cuando el
 * objetivo es el real del día, no el genérico.
 *
 * Compartido por la pestaña Hoy y el detalle de un día pasado en Plan.
 */
export function MacroBars({
  estimate,
  target,
  weightKg,
  note,
}: {
  estimate: MacroEstimate;
  target: MacroEstimate | null;
  weightKg: number | null;
  /** Frase bajo la barra. Por defecto, la de Hoy (en curso). */
  note?: string;
}) {
  const fallbackTargets = macroTargets(weightKg);

  return (
    <View className="mt-5">
      <View className="flex-row gap-2.5">
        {MACRO_BAR_ITEMS.map((it) => {
          const value = estimate[it.key];
          const goal = target?.[it.key] || fallbackTargets[it.key];
          const pct = goal > 0 ? Math.round((value / goal) * 100) : 0;
          const width = Math.min(100, pct);
          return (
            <View key={it.key} className="flex-1">
              <View className="h-[5px] overflow-hidden rounded-full bg-secondary">
                <View
                  className="h-full rounded-full"
                  style={{ width: `${width}%`, backgroundColor: it.color }}
                />
              </View>
              <Text className="font-mono-medium mt-1.5 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                {it.label}
              </Text>
              <Text className="font-mono-medium mt-0.5 text-[11px] text-foreground">
                {value} g{target ? ` · ${pct}%` : ""}
              </Text>
            </View>
          );
        })}
      </View>
      <Text className="font-body mt-2.5 text-[10.5px] text-muted-foreground">
        {note ?? `~${estimate.kcal} kcal de lo que llevas comido hoy`}: estimación orientativa, no
        un conteo nutricional exacto.
      </Text>
    </View>
  );
}
