import { ActivityIndicator, Pressable, Text, View } from "react-native";

/**
 * Aviso: a uno o más peques de triturados les falta su puré en el plan —
 * pasa cuando se da de alta o se cambia de etapa a un bebé DESPUÉS de que el
 * plan del mes ya estaba generado (`childPureeGaps`, `lib/plan-shared.ts`).
 * "Actualizar" llama a `/api/v1/plan/child-meal-fill`, que solo AÑADE lo que
 * falta: el plato de la mesa y el resto del plan no se tocan. Copia de
 * `src/components/child-meal-gap-banner.tsx` (web).
 */
export function ChildMealGapBanner({
  names,
  pending,
  onUpdate,
}: {
  names: string[];
  pending: boolean;
  onUpdate: () => void;
}) {
  if (!names.length) return null;
  const label =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;

  return (
    <View className="mt-3 flex-row items-center justify-between gap-3 rounded-[16px] bg-warning/15 px-3.5 py-3">
      <Text className="flex-1 text-[12.5px] leading-[17px] text-foreground">
        Falta el menú de {label} en el plan.
      </Text>
      <Pressable
        onPress={onUpdate}
        disabled={pending}
        className={`flex-row items-center gap-1.5 rounded-full bg-foreground px-3.5 py-2 active:opacity-80 ${
          pending ? "opacity-60" : ""
        }`}
      >
        {pending ? <ActivityIndicator size="small" color="#fbfaf7" /> : null}
        <Text className="text-[12px] font-medium text-background">
          {pending ? "Actualizando…" : "Actualizar"}
        </Text>
      </Pressable>
    </View>
  );
}
