import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isCleanFood } from "@/lib/content-guard";

/**
 * Precalentamiento de la caché de recetas (ticket 06 de `precision-nutricional`,
 * D13): todos los platos del plan se calculan al generarlo, para que ninguno
 * llegue a Hoy "calculando".
 *
 * El cliente manda los platos del mes en trozos (`WARM_CHUNK`), varios en
 * paralelo, y enseña el progreso ("Calculando tus platos 24/48"). Nada queda
 * corriendo en el servidor después de responder (serverless): si la app se
 * cierra a medias, la pantalla Plan lo retoma al abrirse (`recipe-warm.ts`).
 *
 * Un plato ya en la caché global no llama al modelo. Ruta espejo:
 * `POST /api/v1/recipes/warm`.
 */

export const WARM_CHUNK = 8;

export type WarmStatus = "calculado" | "calculando" | "sin-receta";

export const warmRecipes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { dishes?: unknown }) => ({
    dishes: [
      ...new Set(
        (Array.isArray(input?.dishes) ? input.dishes : [])
          .map((d) =>
            String(d ?? "")
              .trim()
              .slice(0, 200),
          )
          // Van a una caché de toda la app: nada que no sea comida.
          .filter((d) => d && isCleanFood(d)),
      ),
    ].slice(0, WARM_CHUNK),
  }))
  .handler(
    async ({ data, context }): Promise<{ results: { dish: string; status: WarmStatus }[] }> => {
      if (!data.dishes.length) return { results: [] };
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) throw new Error("Falta la clave de IA");

      // Como la guía: el tope diario no corta el cálculo de un plato (D13), el
      // mensual sí.
      const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
      await enforceUserRateLimit(context.userId, "recipe-warm", "month");

      const { getRecipes } = await import("@/lib/nutrition/recipes.server");
      const found = await getRecipes(data.dishes, { apiKey: key, userId: context.userId });
      return {
        results: data.dishes.map((dish) => {
          const f = found.get(dish);
          const status: WarmStatus = f?.recipe
            ? "calculado"
            : f && (f.vague || !f.isFood)
              ? "sin-receta"
              : "calculando";
          return { dish, status };
        }),
      };
    },
  );
