# Daily Guide

App de coach de salud y alimentación. TanStack Start + React + TypeScript + Tailwind + Supabase.
La IA (chat del coach, guía diaria, plan mensual) usa OpenRouter (modelo `google/gemini-2.5-flash`
por defecto) a través de `@openrouter/ai-sdk-provider`
(ver [src/lib/ai-provider.server.ts](src/lib/ai-provider.server.ts)); requiere `OPENROUTER_API_KEY` en `.env`.

## Platos del plan: cambio a mano vs. recolocación

Dos caminos distintos, deliberadamente separados:

- `setPlanMeal` ([plan.functions.ts](src/lib/plan.functions.ts), herramienta `cambiar_plato` del
  coach) cambia **un** plato de **un** día, de hoy en adelante, escribiendo literalmente lo que ha
  pedido la persona: sin IA de por medio, así "cámbiame el desayuno de mañana" se aplica de verdad
  y es verificable.
- `adjustMonthlyPlan` recoloca **varios** días futuros para compensar (comió de más, salió a
  correr). Ahí el día de hoy sigue fijado.

El plan base deja desayunos y snacks a nivel de semana (una lista que rota por día), así que un
cambio para un día concreto se guarda en campos propios del día — `breakfast`/`snack` en `PlanDay`
([plan-shared.ts](src/lib/plan-shared.ts)) — y manda sobre la rotación. `mergeFuturePlan` los
conserva: una recolocación automática posterior no pisa lo que se pidió a mano.

La lista de la compra **nunca** cambia. Si el plato pide algo que no se compró, se guarda igual y
los ingredientes que faltan quedan en `PlanDay.extras[comida]`, que se pintan como aviso ("Fuera de
tu compra: ...") en Hoy y en el calendario del plan. Quién falta lo decide el modelo
(`offShoppingList`), porque casar texto libre con la lista a ojo no funciona ("pechuga de pollo" lo
cubre "pollo"); si esa comprobación falla no se marca nada, mejor no avisar que avisar en falso.

Para que el coach pueda proponer platos con lo ya comprado, cada mensaje del chat lleva la lista de
ingredientes y el menú de los próximos días (`coachPlanContext`), además de la fecha de hoy — sin
ella el modelo no puede convertir "mañana" en la fecha que necesita la herramienta.

## Push notifications

Web Push real (VAPID) vía [`@pushforge/builder`](https://github.com/draphy/pushforge) — usa solo
Web Crypto API, así que funciona en Cloudflare Workers (el `web-push` de npm no, depende de
`crypto.createECDH()` que Workers no soporta). Requiere en `.env`: `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` (servidor, par generado con `bun x pushforge vapid`), `VITE_VAPID_PUBLIC_KEY`
(cliente, mismo valor que la pública), y `CRON_SECRET` (protege `/api/cron/dispatch`, ver abajo).

El disparo periódico **no** usa el `scheduled` nativo de Cloudflare Workers — este proyecto
sustituye el entry-point autogenerado de Nitro por [src/server.ts](src/server.ts), que solo
expone `fetch`, así que enganchar ahí un Cron Trigger de Cloudflare es incierto sin desplegar y
probar. En su lugar, un workflow de GitHub Actions
([.github/workflows/push-dispatch.yml](.github/workflows/push-dispatch.yml)) llama cada 15 min a
`POST /api/cron/dispatch` (protegido por `x-cron-secret`), que reutiliza
[src/lib/push-dispatch.server.ts](src/lib/push-dispatch.server.ts) para mirar qué perfiles caen en
la ventana de su `morning_time`/`evening_time` (asumiendo `Europe/Madrid`) y enviar el push.
Necesita los secrets de repo `APP_URL` y `CRON_SECRET` en GitHub una vez desplegada la app.

El copy de mañana/noche y la frecuencia de contacto varían según `profiles.tone`
(relajado/neutro/exigente, ver `morningCopy`/`eveningCopy` en
[push-dispatch.server.ts](src/lib/push-dispatch.server.ts)): tono relajado se salta el push de la
noche si el día ya está completo (menos ruido cuando no hace falta), exigente siempre lo recibe y
nombra cuántas comidas quedan por registrar. Mismo tono, aplicado también en el repaso nocturno
(`NightlyReviewSheet`) y en el prompt del coach (`toneLine` en
[ai-provider.server.ts](src/lib/ai-provider.server.ts)) — tres superficies distintas, un solo campo
de perfil.
