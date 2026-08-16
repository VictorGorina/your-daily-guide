import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, CookingPot } from "lucide-react";
import { useState } from "react";

import { dishRecipe } from "@/lib/plan.functions";

/**
 * Disclosure que muestra la receta simplificada de un plato. La receta se pide
 * solo al abrir (perezoso) y se cachea por nombre de plato en react-query, así
 * que expandir el mismo plato en otra pantalla no vuelve a llamar a la IA.
 */
export function DishRecipe({ dish, month }: { dish: string; month?: string }) {
  const [open, setOpen] = useState(false);
  const fetchRecipe = useServerFn(dishRecipe);
  const q = useQuery({
    queryKey: ["recipe", dish],
    queryFn: () => fetchRecipe({ data: { dish, month } }),
    enabled: open,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (!dish) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-primary"
      >
        <CookingPot className="h-3.5 w-3.5 shrink-0" />
        {open ? "Ocultar receta" : "Ver receta"}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="animate-sheet-up mt-2 rounded-xl bg-secondary/50 p-3 text-left">
          {q.isLoading ? (
            <p className="animate-pulse text-xs text-muted-foreground">Preparando la receta…</p>
          ) : q.data ? (
            <div className="space-y-2.5">
              {q.data.ingredients.length ? (
                <div>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Ingredientes
                  </span>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {q.data.ingredients.map((ing) => (
                      <li
                        key={ing}
                        className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-foreground"
                      >
                        {ing}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Pasos
                </span>
                <ol className="mt-1 space-y-1">
                  {q.data.steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-xs text-foreground">
                      <span className="shrink-0 font-semibold text-primary">{i + 1}.</span>
                      <span className="hyphens-auto min-w-0 text-pretty">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => q.refetch()}
              className="text-xs font-medium text-primary"
            >
              No hemos podido cargar la receta. Reintentar
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
