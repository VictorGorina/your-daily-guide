import { Apple, Bean, Beef, Carrot, Drumstick, Fish, Milk, Wheat } from "lucide-react-native";
import { Image } from "react-native";
import { SvgXml } from "react-native-svg";

import {
  classifyDish,
  dishAsset,
  FOOD_CATEGORIES,
  type FoodCategory,
} from "../lib/food-categories";
import { FOOD_SVGS } from "../lib/food-svg-data";

// `dishAsset()` devuelve rutas al estilo web ("/food/icon-salmon.svg",
// "/food/cat-verduras.png") porque food-categories.ts es una copia literal de
// src/lib/food-categories.ts (ver ese archivo). Aquí se resuelven a nivel
// local: los SVG se incrustan como texto (food-svg-data.ts, generado desde
// public/food/*.svg) y se pintan con <SvgXml>, sin necesitar un transformer
// de Metro; los PNG de categoría van por el require() estático de siempre.
const PNG_ASSETS: Record<string, number> = {
  "cat-verduras": require("../assets/food/cat-verduras.png"),
  "cat-carne": require("../assets/food/cat-carne.png"),
  "cat-fruta": require("../assets/food/cat-fruta.png"),
  "cat-lacteos": require("../assets/food/cat-lacteos.png"),
  "cat-aves": require("../assets/food/cat-aves.png"),
  "cat-cereales": require("../assets/food/cat-cereales.png"),
  "cat-legumbres": require("../assets/food/cat-legumbres.png"),
  "cat-pescado": require("../assets/food/cat-pescado.png"),
};

/**
 * Ilustración a mano del ingrediente principal de un plato, o de su categoría
 * si no hay una más concreta — misma lógica que `DishImage` en la web
 * (src/components/food-category-bg.tsx), resuelta contra los assets locales
 * de arriba. Puramente decorativa: si `dishAsset` no encuentra nada, no
 * renderiza nada (el caller decide el fallback, igual que en la web).
 */
export function DishImage({ dish, size = 40 }: { dish: string; size?: number }) {
  const asset = dishAsset(dish);
  if (!asset) return null;
  const key = asset.replace("/food/", "").replace(/\.(svg|png)$/, "");

  if (asset.endsWith(".svg")) {
    const xml = FOOD_SVGS[key];
    if (!xml) return null;
    return <SvgXml xml={xml} width={size} height={size} />;
  }

  const png = PNG_ASSETS[key];
  if (!png) return null;
  return (
    <Image
      source={png}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      resizeMode="cover"
    />
  );
}

// Mezcla dos hex de 6 dígitos (t=0 → a, t=1 → b). RN no tiene `color-mix`.
function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

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

/**
 * Icono Lucide por categoría de comida — la misma familia que los iconos de la
 * subpestaña Ingredientes (`CategoryIcon` en app/(app)/plan.tsx) y que la web
 * (src/components/food-category-bg.tsx). Sustituye a `DishImage` en las filas
 * de comida de Hoy: un glifo de sistema se lee mejor a 40px y no depende de
 * tener un SVG propio para cada plato. `otro` no dibuja nada (guideline §6:
 * sin glifo de relleno), el hueco se queda con solo el tinte.
 */
export function DishCategoryIcon({ dish, size = 18 }: { dish: string; size?: number }) {
  const cat = classifyDish(dish);
  const Icon = CATEGORY_ICON[cat];
  if (!Icon) return null;
  // Mismo criterio que `FoodCategoryBadge` en la web: el acento teñido hacia el
  // color de texto para que siga legible con acentos muy claros (lácteos,
  // cereales) sobre el tinte suave del círculo.
  return <Icon size={size} color={mixHex(FOOD_CATEGORIES[cat].accent, "#3e3d39", 0.6)} />;
}
