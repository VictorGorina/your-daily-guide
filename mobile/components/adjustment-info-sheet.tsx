import { Text, View } from "react-native";

import type { MealChange } from "../lib/plan-shared";
import { Sheet } from "./ui/sheet";

const weekdayShort = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/**
 * Qué cambió en el plan futuro tras un cambio de plato. Se abre desde el badge
 * "i" de la comida en Hoy. Copia nativa de `src/components/adjustment-info-sheet.tsx`.
 */
export function AdjustmentInfoSheet({
  open,
  onOpenChange,
  changes,
  dish,
  kcalDelta,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: MealChange[];
  dish: string;
  /** Desvío estimado del día frente a lo que preveía el plan, si se pudo calcular. */
  kcalDelta?: number | null;
}) {
  // Redondeo en decenas: es una estimación de la IA, no una cifra exacta.
  const rounded =
    typeof kcalDelta === "number" && Math.abs(kcalDelta) >= 50
      ? `${kcalDelta > 0 ? "+" : "−"}${Math.round(Math.abs(kcalDelta) / 10) * 10} kcal`
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Ajuste del plan">
      <View className="gap-3 px-4 pb-8">
        <Text className="text-sm text-muted-foreground">
          Tras comer <Text className="font-medium text-foreground">{dish}</Text>
          {rounded ? (
            <Text>
              , hoy llevas <Text className="font-medium text-foreground">{rounded}</Text> frente a
              lo que preveía el plan
            </Text>
          ) : null}
          {changes.length ? ". Se han recolocado estos platos futuros:" : "."}
        </Text>

        {changes.length === 0 ? (
          // Sin cifra no se puede afirmar que el plan siga equilibrado: solo
          // sabemos que el coach no ha movido nada. Con cifra, se dice.
          <Text className="text-sm text-muted-foreground">
            {rounded
              ? `El coach no ha movido ningún plato futuro: considera que ${
                  (kcalDelta ?? 0) > 0 ? "el exceso" : "la diferencia"
                } se absorbe con lo que ya tienes planificado.`
              : "El coach no ha movido ningún plato futuro."}
          </Text>
        ) : (
          changes.map((c) => (
            <View key={`${c.date}-${c.slot}`} className="rounded-2xl bg-secondary/60 px-3.5 py-3">
              <Text className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                {weekdayShort(c.date)} · {c.slotLabel}
              </Text>
              <View className="mt-1.5 flex-row flex-wrap items-start gap-2">
                <Text className="text-sm text-muted-foreground line-through">{c.before}</Text>
                <Text className="text-sm text-muted-foreground">→</Text>
                <Text className="text-sm font-medium text-foreground">{c.after}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </Sheet>
  );
}
