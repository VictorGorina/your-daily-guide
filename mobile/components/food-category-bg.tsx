import { Image } from "react-native";
import { SvgXml } from "react-native-svg";

import { dishAsset } from "../lib/food-categories";
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
