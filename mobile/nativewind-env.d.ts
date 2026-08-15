/// <reference types="nativewind/types" />

// El prebuild de Expo regenera expo-env.d.ts y se lleva cualquier añadido, así
// que la declaración del import de CSS (que Metro resuelve vía NativeWind pero
// TypeScript no) vive aquí, en un archivo propio que el prebuild no toca.
declare module "*.css" {}
