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
  La API devuelve `{"error": mensaje}` con un texto que se enseña siempre tal cual (tabla de
  códigos en el AGENTS.md de la raíz); `ApiError.status` solo decide qué hacer. `api.ts` ya
  resuelve tres casos: corta a los 30 s (280 s en las rutas con IA, `LONG_ROUTES`: **una ruta
  nueva que llame al modelo va ahí**, o el móvil la aborta antes de tiempo) con un `ApiError`
  408; ante un 401 renueva la sesión una vez y repite (si vuelve a dar 401, cierra sesión en este
  dispositivo); y un 429 trae `retryAfter` en segundos, sin reintento automático. Cada petición
  lleva `X-Client-Version` (`version+buildNumber` de `app.json`).

## Sesión y enlaces

- **La sesión va cifrada** ([lib/secure-session-storage.ts](lib/secure-session-storage.ts)): la
  clave AES en el llavero (`expo-secure-store`) y la sesión cifrada en AsyncStorage con el prefijo
  `enc1:`. Un valor sin prefijo es de una versión anterior y se cifra al leerlo. No guardes tokens
  en AsyncStorage a pelo, y no uses `aesjs.utils.utf8` para el texto: no lee UTF-8 de 4 bytes (un
  emoji) y la sesión quedaba ilegible.
- **Un enlace de confirmar o restablecer no cambia de cuenta sin preguntar**
  (`mayUseLinkSession`, [lib/link-account.ts](lib/link-account.ts)): toda pantalla nueva que
  instale una sesión a partir de un enlace pasa antes por ahí.
- **Accesibilidad:** todo `Pressable` lleva `accessibilityRole`; si no tiene texto visible,
  `accessibilityLabel`; si es un chip o una pestaña, `accessibilityState`; y menos de 44 pt de lado
  se compensa con `hitSlop`.

## Versiones que no se pueden tocar a la ligera

**NativeWind v4 exige Tailwind v3, no v4.** La v4 quitó la API de configuración en la que se apoya
y la combinación **no genera ningún estilo, sin dar ningún error**. `expo install tailwindcss`
instala la v4: hay que forzar `tailwindcss@^3.4.17` a mano. (La web sí usa Tailwind v4; son dos
configuraciones distintas a propósito.)

La paleta de [tailwind.config.js](tailwind.config.js) es el tema "niebla" de la web
(`:root` en `src/styles.css`, en hex) copiado a mano, porque React Native no lee las variables CSS
de la web. Si allí cambia un color, hay que copiarlo aquí: son dos copias.

`.npmrc` fija `legacy-peer-deps` porque el árbol de Expo 57 choca consigo mismo (expo-router
arrastra react-dom 19.2.8 y expo fija react 19.2.3); sin eso npm no instala nada.

**Los `overrides` de `package.json`** (ticket 41 de la auditoría) fuerzan versiones corregidas en
herramientas de prebuild y de build; ninguna llega al bundle de la app. El tope de cada una no es
casual:

- `@bacons/xcode` → `@xmldom/xmldom ^0.8.15`. Su `@expo/plist` 0.0.18 pide `~0.7.0`, una rama sin
  parches. **No subir a 0.9:** ahí `parseFromString` exige el tipo MIME y lanza `TypeError`. Se
  quita cuando `@bacons/apple-targets` traiga un `@expo/plist` actual.
- `uuid ^11.1.1` bajo `xcode` y `@bacons/xcode`. `xcode` solo llama a `uuid.v4()`, con `require`.
  **No pasar de la 11:** la 12 ya no publica CommonJS.
- `postcss-selector-parser ^7.1.6`. Tailwind 3 pide `^6`, que no tiene parche. Es el único que
  puede fallar sin avisar (ver arriba, NativeWind y Tailwind): al tocarlo, genera el CSS antes y
  después (`NATIVEWIND_OS=ios npx tailwindcss --input ./global.css --output <archivo>`) y
  comprueba que sale idéntico.

## El directorio `ios/` no se toca a mano

`expo run:ios` genera `ios/` con _prebuild_ a partir de `app.json`, y está en `.gitignore` a
propósito. Cualquier cambio de configuración nativa (permisos, capacidades, iconos, bundle id) va
en `app.json` o en un config plugin: lo que se edite dentro de `ios/` se pierde en el siguiente
prebuild.

**El icono del widget tampoco se versiona.** `@bacons/apple-targets` escribe en cada prebuild
`targets/widget/Assets.xcassets/AppIcon.appiconset/` a partir del `icon` de
[targets/widget/expo-target.config.js](targets/widget/expo-target.config.js) (hoy, el icono de la
app): es un derivado que cae fuera de `ios/`, así que tiene su propia línea en `.gitignore`.
Versionado, se quedaba con el icono viejo cada vez que cambiaba `assets/icon.png` y todo prebuild
dejaba 15 PNG modificados. Para cambiar el icono del widget se cambia `icon`, no los PNG.

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

**Sentry (`@sentry/react-native`) sin subir source maps ni símbolos:** su plugin añade al build de
Xcode una fase que llama a `sentry-cli`, que falla sin token (y npm bloquea el postinstall que
baja el binario). Compila con `SENTRY_DISABLE_AUTO_UPLOAD=true` delante (también está en los
perfiles de `eas.json`): `SENTRY_DISABLE_AUTO_UPLOAD=true LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
npx expo run:ios`. Sin `EXPO_PUBLIC_SENTRY_DSN`, la app no inicia Sentry (`lib/sentry.ts`).

**`expo-image-picker` / `expo-image-manipulator`** (escaneo del tiquet de la compra en
`app/(app)/plan.tsx`, `ShopModeView`) están en `package.json` y en `plugins` de `app.json`, pero
**necesitan un prebuild + build nativo** para funcionar: hasta entonces el botón "Escanear tiquet"
avisa ("estará disponible en la próxima versión") en vez de fallar, porque la carga del módulo va
en un `import()` dinámico envuelto en try/catch. La web ya lleva la función completa (usa
`<input type="file">` + canvas).

**`expo-haptics` y `expo-file-system`** (vibración al dictar; archivo del historial en Ajustes)
siguen el mismo patrón: cargados con `import()` y con aviso si el build nativo es anterior. Hasta
el siguiente prebuild + build, dictar funciona sin vibrar y "Descargar historial" avisa. La onda
del dictado (`components/dictation-field.tsx`) no necesita build: usa el `Animated` clásico.

## Desarrollo

```sh
cp .env.example .env   # y rellena con los mismos valores que el .env de la raíz
npx expo start
```

`EXPO_PUBLIC_API_URL` apunta al `bun run dev` de la web. En el simulador vale `localhost`; desde un
iPhone real hace falta la IP de la Mac en la red local **y** arrancar la web con `DEV_HOST=:: bun
run dev`: por defecto el servidor de desarrollo solo escucha en `127.0.0.1`, para que nadie más
en la misma wifi llegue a él.

Los perfiles `preview` y `production` de [eas.json](eas.json) apuntan al **mismo** proyecto de
Supabase y a la misma API de producción. Es una decisión, no un olvido: el plan gratuito da un
solo proyecto, así que un build de prueba escribe datos reales (usa un perfil demo). Un proyecto
de staging sería un coste nuevo y queda fuera por ahora.

**`eas-cli` no es dependencia del proyecto** (ticket 41 de la auditoría, MOB-20). Los scripts
`build:ios` y `submit:ios` usan el `eas` instalado global (`npm install --global eas-cli`; vale
también `npx eas-cli@latest`), que es lo que pide su README. Como `devDependency` metía unos 320
paquetes en el lockfile con versiones fijadas (`joi`, `nanoid`, `minimatch`) que desde aquí no se
podían subir. `eas.json` ya exige la versión mínima (`cli.version`).

Requiere **Xcode** para el simulador (no basta con las Command Line Tools) y **Node** (Metro no
corre sobre Bun, a diferencia de la web).
