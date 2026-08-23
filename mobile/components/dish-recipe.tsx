import { useQuery } from "@tanstack/react-query";
import { ChevronDown, CookingPot } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { apiPost } from "../lib/api";

type DishRecipe = { ingredients: string[]; steps: string[] };

/**
 * Disclosure con la receta simplificada de un plato, equivalente RN de
 * DishRecipe en la web (src/components/dish-recipe.tsx). La receta se pide
 * solo al abrir (perezoso) y se cachea por nombre de plato en react-query, vía
 * la ruta espejo /api/v1/plan/recipe (dishRecipe no es invocable desde móvil).
 */
export function DishRecipe({ dish, month }: { dish: string; month?: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["recipe", dish],
    queryFn: () => apiPost<DishRecipe>("plan/recipe", { dish, month }),
    enabled: open,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (!dish) return null;

  return (
    <View className="mt-2">
      <Pressable
        onPress={() => setOpen((o) => !o)}
        className="flex-row items-center gap-1.5 self-start active:opacity-70"
      >
        <CookingPot size={14} color="#ff8a3d" />
        <Text className="font-body-semibold text-[11px] text-primary">
          {open ? "Ocultar receta" : "Ver receta"}
        </Text>
        <ChevronDown
          size={14}
          color="#ff8a3d"
          style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {open ? (
        <View className="mt-2 rounded-xl bg-secondary/50 p-3">
          {q.isLoading ? (
            <Text className="font-body text-xs text-muted-foreground">Preparando la receta…</Text>
          ) : q.data ? (
            <View className="gap-2.5">
              {q.data.ingredients.length ? (
                <View>
                  <Text className="font-mono-medium text-[10px] uppercase tracking-wide text-muted-foreground">
                    Ingredientes
                  </Text>
                  <View className="mt-1 flex-row flex-wrap gap-1.5">
                    {q.data.ingredients.map((ing) => (
                      <View key={ing} className="rounded-full bg-surface px-2 py-0.5">
                        <Text className="font-body text-[11px] text-foreground">{ing}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
              <View>
                <Text className="font-mono-medium text-[10px] uppercase tracking-wide text-muted-foreground">
                  Pasos
                </Text>
                <View className="mt-1 gap-1">
                  {q.data.steps.map((step, i) => (
                    <View key={i} className="flex-row gap-2">
                      <Text className="font-body-semibold text-xs text-primary">{i + 1}.</Text>
                      <Text className="font-body flex-1 text-xs text-foreground">{step}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => q.refetch()}>
              <Text className="font-body-medium text-xs text-primary">
                No hemos podido cargar la receta. Reintentar
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}
