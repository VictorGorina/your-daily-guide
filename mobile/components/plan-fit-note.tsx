import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { PlanFitChange, PlanFitMark } from "../lib/plan-shared";

/**
 * Lo que cambió la comprobación del plan contra el objetivo (ticket 10 de
 * `precision-nutricional`, `fitMonthlyPlan`), dentro de "Cómo enfocamos el mes".
 * Un cambio automático del plan tiene que verse. Sin cifras: vale igual con
 * `nutrition_numbers = ocultar`. Copia de `src/components/plan-fit-note.tsx`.
 */

/** Cambios a la vista; el resto tras "Ver los N". */
const INLINE_CHANGES = 3;

const dayLabel = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { weekday: "short", day: "numeric" });

const SLOT_LABEL: Record<PlanFitChange["slot"], string> = {
  desayuno: "Desayuno",
  comida: "Comida",
  cena: "Cena",
  merienda: "Merienda",
};

/** "mar 15 · Cena", o para una idea de la semana "Merienda · 4 días desde mar 15". */
const changeLabel = (c: PlanFitChange) =>
  c.days && c.days > 1
    ? `${SLOT_LABEL[c.slot]} · ${c.days} días desde ${dayLabel(c.date)}`
    : `${dayLabel(c.date)} · ${SLOT_LABEL[c.slot]}`;

export function PlanFitNote({ fit, fitting }: { fit?: PlanFitMark; fitting: boolean }) {
  const [all, setAll] = useState(false);
  if (fitting && !fit) {
    return (
      <View className="mt-3 flex-row items-center gap-2">
        <ActivityIndicator size="small" color="#ff8a3d" />
        <Text className="text-xs text-muted-foreground">Ajustando tus platos a tu objetivo…</Text>
      </View>
    );
  }
  if (!fit?.changed.length) return null;

  const n = fit.changed.length;
  const shown = all ? fit.changed : fit.changed.slice(0, INLINE_CHANGES);
  return (
    <View className="mt-4 border-t border-border/60 pt-4">
      <Text className="text-sm font-sans-medium text-foreground">
        He cambiado {n} {n === 1 ? "plato" : "platos"} para que tus días lleguen a lo que necesitas
      </Text>
      <Text className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Ajustando solo la cantidad no llegaban.
      </Text>
      <View className="mt-3 gap-2">
        {shown.map((c) => (
          <View key={`${c.date}-${c.slot}`} className="rounded-2xl bg-secondary/60 px-3 py-2.5">
            <Text className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
              {changeLabel(c)}
            </Text>
            <View className="mt-1 flex-row flex-wrap items-start gap-1.5">
              <Text className="font-body text-[13px] text-muted-foreground line-through">
                {c.from}
              </Text>
              <Text className="font-body text-[13px] text-muted-foreground">→</Text>
              <Text className="font-body text-[13px] text-foreground">{c.to}</Text>
            </View>
          </View>
        ))}
      </View>
      {n > INLINE_CHANGES ? (
        <Pressable onPress={() => setAll((v) => !v)} hitSlop={8} className="mt-2">
          <Text className="text-xs font-sans-medium text-primary">
            {all ? "Ver menos" : `Ver los ${n}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
