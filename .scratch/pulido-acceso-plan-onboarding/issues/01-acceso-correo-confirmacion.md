# 01 — Acceso: confirmación de alta por Resend, errores en español y reenvío

Status: implementado y verificado en producción (2026-09-07)
Incidencias del usuario: ⓵ (correo en spam) + ⓶ (error raro al entrar)

## Objetivo

Que darse de alta por correo funcione de punta a punta: el correo llega (y no a spam), si
algo falla se dice en español, y si la cuenta quedó sin confirmar hay una salida dentro de la
app en vez de un callejón sin salida.

## Contexto

Ver el diagnóstico completo en `../spec.md` (sección ⓵ + ⓶). Lo esencial: el reset de
contraseña ya va por nuestro backend con Resend, pero el alta no; y no existe reenvío de
confirmación en ninguna de las dos apps.

## Tareas

1. **Correo de confirmación por Resend** (`src/lib/email.server.ts`):
   - Añadir `signupConfirmationEmail(actionLink)` junto a `passwordResetEmail`, misma
     plantilla y paleta (estilos en línea, ver `docs/design-guidelines.md`).
   - Nueva server function en `src/lib/auth.functions.ts` calcando `requestPasswordReset`:
     `supabaseAdmin.auth.admin.generateLink({ type: "signup", email, password, options: {
     redirectTo } })` (que **no** envía nada) y enviar nosotros con `sendEmail`.
   - `redirectTo` lo decide el servidor a partir de `platform` (`web` → `${PUBLIC_URL}/confirmado`,
     `mobile` → esquema nativo), nunca aceptarlo del cliente — mismo motivo que en el reset
     (redirector abierto con token en la URL).
   - Rate limit por correo con `checkEmailRateLimit`, y responder siempre lo mismo exista o
     no la cuenta (política antienumeración ya establecida en el reset).
2. **El alta deja de usar el envío de Supabase** (`src/components/auth-flow.tsx:159-177`):
   llamar a la server function nueva en lugar de depender del correo de `signUp()`.
3. **Errores en español** (`src/components/auth-flow.tsx:187`): sustituir el
   `toast.error(error.message)` crudo por un mapa de códigos de Supabase. Cubrir al menos
   `email_not_confirmed`, `invalid_credentials`, `user_already_exists`, `over_email_send_rate_limit`.
   Claves nuevas en `src/locales/es.json` y `en.json`.
4. **Reenviar confirmación**: cuando el error sea `email_not_confirmed`, enseñar un botón
   "Reenviar correo de confirmación" que llame a la server function del punto 1. Es lo que le
   faltó al usuario en agosto.
5. **Disclaimer de spam**: retocar `auth.sentConfirm` y `auth.sentReset` en `es.json` / `en.json`
   para que digan que mire la carpeta de spam. Tono según `docs/design-guidelines.md`.
6. **Espejo `/api/v1`**: exponer la operación nueva en `src/routes/api/v1/auth/` vía `apiPost`.
7. **Móvil**: replicar 2, 3, 4 y 5 en `mobile/app/auth.tsx`.

## Verificación

- Alta con un correo desechable: comprobar que el correo llega **desde `hola@peppersfam.es`**
  con nuestra plantilla, no la de Supabase, y que no cae en spam.
- Intentar entrar con esa cuenta sin confirmar → mensaje en español + botón de reenvío;
  pulsarlo reenvía.
- `bun run lint` / `typecheck` / `test` verdes; `tsc` de `mobile/` verde.

## Hecho cuando

Un alta nueva se completa sin tocar el panel de Supabase, y una cuenta sin confirmar tiene
salida desde la propia pantalla de acceso, en las dos apps.

## Notas

- **Nunca** proponer volver al servicio de correo integrado de Supabase: el usuario lo
  rechazó el 2026-08-29 (tope de ~2 mensajes/hora). Resend es decisión deliberada.
- La cuenta del propio usuario ya se confirmó a mano; no es evidencia de que esto esté
  arreglado.


## Hecho — sesión 2026-09-07

Todas las tareas 1-7 implementadas en web y móvil. Verificado en real, sin hipótesis:

- **Sonda directa a Supabase** (`admin.generateLink`, sin enviar nada): un alta nueva genera
  enlace; la misma cuenta sin confirmar admite un segundo `generateLink` (eso es lo que hace el
  reenvío); una cuenta ya confirmada devuelve `email_exists` y **no** cambia la contraseña
  (comprobado: la contraseña original seguía entrando, la nueva no). Sin agujero de seguridad.
- **Envío real por Resend**: `POST /api/v1/auth/confirm` contra el servidor de desarrollo, con un
  correo de Mailinator (buzón público de usar y tirar). Llegó desde `hola@peppersfam.es` (IP de
  Amazon SES, la de Resend), asunto "Confirma tu cuenta de Peppers" (no el genérico de Supabase),
  y el enlace apuntaba a `https://www.peppersfam.es/confirmado` tal cual lo decide el servidor.
  Cuenta de la sonda borrada de Auth al terminar.
- **Error en español**: probado en el navegador (perfil demo, sesión anónima) que
  `Invalid login credentials` ahora sale como "El correo o la contraseña no coinciden. Prueba
  otra vez." — antes salía el texto de Supabase en inglés.
- Estáticas verdes: `bun run lint` / `typecheck` / `test` (220 tests, +10 nuevos de
  `auth-errors.test.ts`) y `tsc` de `mobile/`.

No verificado en esta sesión (fuera del alcance de una comprobación automática): el disclaimer de
spam retocado no se ha visto en pantalla con capturas; y el botón "Reenviar" no se ha pulsado
desde la UI real (sí se probó el mismo código de servidor que ese botón llama).
