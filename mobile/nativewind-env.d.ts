/// <reference types="nativewind/types" />

// El prebuild de Expo regenera expo-env.d.ts y se lleva cualquier añadido, así
// que la declaración del import de CSS (que Metro resuelve vía NativeWind pero
// TypeScript no) vive aquí, en un archivo propio que el prebuild no toca.
declare module "*.css" {}

// Iconos de categoría de alimento (mobile/assets/food/*.png, ver
// mobile/components/food-category-bg.tsx) — require() los resuelve a un id de
// asset numérico vía Metro, pero TypeScript no trae esa declaración por defecto.
declare module "*.png" {
  const value: number;
  export default value;
}
