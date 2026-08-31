# Peppers — app nativa (Expo)

App de iOS en React Native. Comparte backend con la web: **el mismo proyecto de Supabase**
(mismo JWT, mismas políticas RLS) y las rutas `/api/v1/*` de la web (ver AGENTS.md de la raíz).

No es un monorepo: la web sigue en `src/` en la raíz y esta app vive aparte en `mobile/`. No hay
código compartido por ahora — cuando duela duplicar, se monta `packages/shared/`.

## Cómo llama al backend

- **CRUD normal** (perfil, registros del día, hogar): directo con `supabase` desde
  [lib/supabase.ts](lib/supabase.ts), igual que hace la web desde el navegador. Las políticas RLS
  son las que protegen los datos.
- **Operaciones de IA y las que necesitan clave de servicio**: por HTTP con
  [lib/api.ts](lib/api.ts) contra `/api/v1/*`, adjuntando el token de Supabase como Bearer.
  Ojo con los errores: la API devuelve `{"error": mensaje}` con textos para enseñar tal cual, y su
  código de estado no distingue "dato inválido" de "fallo real" — guíate por el mensaje y por el 401.

## Versiones que no se pueden tocar a la ligera

**NativeWind v4 exige Tailwind v3, no v4.** La v4 quitó la API de configuración en la que se apoya
y la combinación **no genera ningún estilo, sin dar ningún error**. `expo install tailwindcss`
instala la v4: hay que forzar `tailwindcss@^3.4.17` a mano. (La web sí usa Tailwind v4; son dos
configuraciones distintas a propósito.)

La paleta de [tailwind.config.js](tailwind.config.js) es el tema "niebla" de la web
(`:root` en `src/styles.css`) convertido de `oklch()` a hex, porque React Native no entiende
`oklch`. Si allí cambia un color, hay que reconvertirlo aquí: son dos copias.

`.npmrc` fija `legacy-peer-deps` porque el árbol de Expo 57 choca consigo mismo (expo-router
arrastra react-dom 19.2.8 y expo fija react 19.2.3); sin eso npm no instala nada.

## El directorio `ios/` no se toca a mano

`expo run:ios` genera `ios/` con _prebuild_ a partir de `app.json`, y está en `.gitignore` a
propósito. Cualquier cambio de configuración nativa (permisos, capacidades, iconos, bundle id) va
en `app.json` o en un config plugin: lo que se edite dentro de `ios/` se pierde en el siguiente
prebuild.

CocoaPods hace falta para compilar. Instálalo con `brew install cocoapods`, no con el
`gem install` que intenta Expo por su cuenta: ese usa el Ruby del sistema y se queda pidiendo
permisos de administrador.

**Compila siempre con locale UTF-8:** `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios
--device <udid>`. Sin locale UTF-8, `pod install` bajo el Ruby de Homebrew muere con
`Unicode Normalization not appropriate for ASCII-8BIT (Encoding::CompatibilityError)`; es un
fallo duro, no un aviso.

**Tras añadir un módulo nativo** (p. ej. `react-native-svg`), Metro sirve caché rancia y lanza
`Unable to resolve module <x>` aunque el módulo esté instalado y el pod compilado. Reinicia
Metro con `npx expo start --clear` (mata antes el Metro que deja `expo run:ios` en el 8081).

**`expo-image-picker` / `expo-image-manipulator`** (escaneo del tiquet de la compra en
`app/(app)/plan.tsx`, `ShopModeView`) están en `package.json` y en `plugins` de `app.json`, pero
**necesitan un prebuild + build nativo** para funcionar: hasta entonces el botón "Escanear tiquet"
avisa ("estará disponible en la próxima versión") en vez de fallar, porque la carga del módulo va
en un `import()` dinámico envuelto en try/catch. La web ya lleva la función completa (usa
`<input type="file">` + canvas).

## Desarrollo

```sh
cp .env.example .env   # y rellena con los mismos valores que el .env de la raíz
npx expo start
```

`EXPO_PUBLIC_API_URL` apunta al `bun run dev` de la web. En el simulador vale `localhost`; desde un
iPhone real hace falta la IP de la Mac en la red local.

Requiere **Xcode** para el simulador (no basta con las Command Line Tools) y **Node** (Metro no
corre sobre Bun, a diferencia de la web).
