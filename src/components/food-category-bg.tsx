import { classifyDish, FOOD_CATEGORIES } from "@/lib/food-categories";

/**
 * Inline style for food-category contextual backgrounds.
 * A soft tint of the category accent over the current surface color (spec §4:
 * "usar normalmente con 10–20% opacidad"), so it stays subtle and
 * automatically follows whichever theme is active. `pct` lets callers go
 * stronger for elements where the tint carries more of the element (e.g. the
 * meal rows in Hoy) — default keeps the original 14% used everywhere else.
 *
 * Usage: <div style={foodBgStyle("Ensalada de tomate")}>…</div>
 */
export function foodBgStyle(dishName: string | undefined | null, pct = 14): React.CSSProperties {
  if (!dishName) return {};
  const cat = classifyDish(dishName);
  if (cat === "otro") return {};
  const entry = FOOD_CATEGORIES[cat];
  return {
    backgroundColor: `color-mix(in oklab, ${entry.accent} ${pct}%, var(--color-surface))`,
  };
}

/**
 * Small circular hand-drawn illustration for the food category of a dish
 * (see public/food/cat-*.png). Purely decorative — the dish name and/or
 * FoodCategoryBadge next to it already carry the information — so it's
 * rendered with an empty alt. Returns null for "otro" (no illustration) or
 * when the dish doesn't classify into a known category.
 */
export function DishImage({
  dish,
  size = 40,
  className,
}: {
  dish: string;
  size?: number;
  className?: string;
}) {
  const cat = classifyDish(dish);
  const entry = FOOD_CATEGORIES[cat];
  if (!entry.asset) return null;
  return (
    <img
      src={entry.asset}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
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
