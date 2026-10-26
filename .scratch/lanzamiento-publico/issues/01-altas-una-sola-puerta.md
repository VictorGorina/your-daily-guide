# 01 · Altas sin bots: cerrar las puertas laterales antes de abrir al público

Status: ready (bloqueado hasta el lanzamiento)

## Por qué

Las cuentas con correo se crean solo por nuestro servidor (`auth/confirm`), con CAPTCHA, cuota y
confirmación del correo («Altas sin bots» en [AGENTS.md](../../../AGENTS.md)). Pero Supabase tiene
dos puertas más que no pasan por ahí y que cualquiera puede usar con la clave publicable, que va
en el bundle de la web:

- su alta pública (`/auth/v1/signup`), que la app no usa;
- la demo anónima («Probar sin cuenta», `signInAnonymously`).

Hoy (2026-10-26) están abiertas a propósito: la demo sigue en la app hasta el lanzamiento. Lo que
amortigua el riesgo mientras tanto: «Confirm email» está encendido (`mailer_autoconfirm: false`
en `/auth/v1/settings`), así que el alta pública solo da cuentas sin confirmar; y la demo tiene
la cuota por IP de Supabase. A esa fecha había 21 usuarios anónimos y 1 con correo: sin abuso.

Por eso el orden importa: activar `TURNSTILE_ENFORCE` sin cerrar estas puertas deja a un bot el
camino de al lado.

## Qué hacer (en este orden)

1. **iOS manda token.** Hecho en el código (`mobile/components/turnstile.tsx` + página
   `/api/v1/auth/captcha`, en `main` desde `0b169ad`); falta el build nativo con
   `react-native-webview` en el iPhone del dueño y una alta de prueba con él.
2. **`TURNSTILE_ENFORCE=1`** en Vercel (Production) y nuevo despliegue. Comprobar:
   `POST /api/v1/auth/reset` sin token y con un correo inventado → `400`; una alta desde iOS y
   otra desde la web funcionan.
3. **Quitar «Probar sin cuenta»** de la web (`src/components/auth-flow.tsx`) y de iOS
   (`mobile/app/auth.tsx`), con su `randomDemoProfile` si ya no lo usa nadie.
4. **Apagar «Allow new users to sign up»** en Supabase (Authentication → Sign In / Providers).
   Cierra a la vez el alta pública y la demo anónima (`Signup` y `SignupAnonymously` miran
   `DisableSignup`). Comprobar justo después:
   - `GET /auth/v1/settings` devuelve `disable_signup: true`;
   - una alta desde la web y otra desde iOS siguen funcionando (`adminGenerateLink` no mira
     `DisableSignup` en el código de Supabase Auth; esto lo confirma en producción);
   - `signInAnonymously` desde la consola del navegador falla.
5. **Si algún día se enciende Google** (`VITE_AUTH_GOOGLE` / `EXPO_PUBLIC_AUTH_GOOGLE`): con el
   alta pública apagada, un usuario nuevo de Google no puede entrar. Revisarlo entonces.

## Comments
