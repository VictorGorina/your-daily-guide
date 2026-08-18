import { classifyDish, FOOD_CATEGORIES } from "@/lib/food-categories";

/**
 * Inline style for food-category contextual backgrounds.
 * A soft 14% tint of the category accent over the current surface color
 * (spec §4: "usar normalmente con 10–20% opacidad"), so it stays subtle and
 * automatically follows whichever theme is active.
 *
 * Usage: <div style={foodBgStyle("Ensalada de tomate")}>…</div>
 */
export function foodBgStyle(dishName: string | undefined | null): React.CSSProperties {
  if (!dishName) return {};
  const cat = classifyDish(dishName);
  if (cat === "otro") return {};
  const entry = FOOD_CATEGORIES[cat];
  return {
    backgroundColor: `color-mix(in oklab, ${entry.accent} 14%, var(--color-surface))`,
  };
}

/**
 * Small emoji badge for the food category of a dish.
 */
export function FoodCategoryBadge({ dish }: { dish: string }) {
  const cat = classifyDish(dish);
  const entry = FOOD_CATEGORIES[cat];
  if (cat === "otro") return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        backgroundColor: `color-mix(in oklab, ${entry.accent} 20%, var(--color-surface))`,
        // Mayormente el color de texto del tema, solo teñido por la categoría —
        // así el badge sigue siendo legible incluso con acentos muy claros
        // (lácteos, cereales).
        color: `color-mix(in oklab, ${entry.accent} 35%, var(--color-foreground))`,
      }}
    >
      {entry.icon} {entry.label}
    </span>
  );
}
