import { Apple, Bean, Beef, Carrot, Drumstick, Fish, Milk, Wheat } from "lucide-react";

import { classifyDish, dishAsset, FOOD_CATEGORIES, type FoodCategory } from "@/lib/food-categories";

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
 * Hand-drawn illustration for a dish's main ingredient (public/food/icon-*.svg).
 * Tries the specific ingredient first (e.g. "salmón" → icon-salmon.svg),
 * falls back to the broad category asset (e.g. icon-pescado.svg), and
 * returns null when nothing matches.  Purely decorative (empty alt).
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
  const asset = dishAsset(dish);
  if (!asset) return null;
  return (
    <img
      src={asset}
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * Icono Lucide por categoría de comida — la misma familia que los iconos de
 * categoría de la subpestaña Ingredientes (Plan). Sustituye al dibujo de
 * ingrediente (`DishImage`) en las filas de comida de Hoy: un glifo de sistema
 * se lee mejor a 40px y no depende de tener un SVG propio para cada plato.
 * `otro` no dibuja nada (guideline §6: sin glifo de relleno para lo que no
 * cae en una categoría) — el hueco se queda con solo el tinte, como antes.
 */
const CATEGORY_ICON: Partial<Record<FoodCategory, typeof Carrot>> = {
  verdura: Carrot,
  fruta: Apple,
  pescado: Fish,
  carne: Beef,
  pollo: Drumstick,
  pasta: Wheat,
  lacteo: Milk,
  legumbre: Bean,
};

export function DishCategoryIcon({
  dish,
  size = 18,
  className,
}: {
  dish: string;
  size?: number;
  className?: string;
}) {
  const cat = classifyDish(dish);
  const Icon = CATEGORY_ICON[cat];
  if (!Icon) return null;
  return (
    <Icon
      size={size}
      className={`shrink-0 ${className ?? ""}`}
      // Mismo criterio que `FoodCategoryBadge`: mayormente el color de texto del
      // tema, teñido por la categoría, para que siga legible con acentos muy
      // claros (lácteos, cereales) sobre el tinte suave del círculo.
      style={{
        color: `color-mix(in oklab, ${FOOD_CATEGORIES[cat].accent} 40%, var(--color-foreground))`,
      }}
      aria-hidden
    />
  );
}

/**
 * Small badge for the food category of a dish. Sin emoji (guideline §6/§9):
 * el color de categoría es el propio dato, un punto de su color puro basta.
 */
export function FoodCategoryBadge({ dish }: { dish: string }) {
  const cat = classifyDish(dish);
  const entry = FOOD_CATEGORIES[cat];
  if (cat === "otro") return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        backgroundColor: `color-mix(in oklab, ${entry.accent} 20%, var(--color-surface))`,
        // Mayormente el color de texto del tema, solo teñido por la categoría —
        // así el badge sigue siendo legible incluso con acentos muy claros
        // (lácteos, cereales).
        color: `color-mix(in oklab, ${entry.accent} 35%, var(--color-foreground))`,
      }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: entry.accent }}
      />
      {entry.label}
    </span>
  );
}
