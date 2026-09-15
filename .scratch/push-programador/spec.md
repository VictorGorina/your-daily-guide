# Spec — Programador fiable para las notificaciones push

Status: deferred — aplazado por el usuario el 2026-09-15 ("guárdalo como pendiente, no lo voy a
aplicar ahora")
Feature slug: `push-programador`

## En una frase

Las notificaciones push programadas (resumen de la mañana, repaso de la noche, aviso de renovación
del plan) dependen de un cron de GitHub Actions que en la práctica se ejecuta cada ~3,5 horas en vez
de cada 15 minutos. Por eso solo sale ~1 de cada 10 avisos. La solución es programar la llamada
desde Supabase con `pg_cron` + `pg_net`.

## Estado a 2026-09-15

- **Hecho:** secretos `APP_URL` y `CRON_SECRET` añadidos en GitHub (antes faltaban y las 50 últimas
  ejecuciones fallaban con `curl: (3) URL rejected`). Ejecución manual (`workflow_dispatch`) correcta:
  `POST /api/cron/dispatch` respondió `{"sent":0,"gone":0,"skippedNoSubscription":0,"skippedLowNeed":0,"errors":0}`,
  así que el secreto coincide con el de Vercel.
- **Pendiente:** el programador. El workflow sigue con `schedule: */15 * * * *` y ahora ya no falla,
  pero llega tarde casi siempre.

## Diagnóstico (medido)

Últimas 100 ejecuciones programadas de `.github/workflows/push-dispatch.yml`, del 2026-09-01 al
2026-09-15:

| | Debería | Real |
|---|---|---|
| Intervalo medio | 15 min | 207 min (~3,5 h) |
| Hueco máximo | 15 min | 365 min (~6 h) |
| Intervalos de ≤ 20 min | 99 de 99 | 0 de 99 |

GitHub trata los workflows programados como "lo mejor que pueda" y los retrasa con carga.

`src/lib/push-dispatch.server.ts` solo envía si la hora elegida por la persona (`morning_time`,
`evening_time`) cae en los últimos `WINDOW_MINUTES = 20` minutos (`inWindow`). Con una ejecución
cada ~207 min, la probabilidad de cubrir esa ventana es ≈ 20 / 207 ≈ **10 %**.

## Decisión propuesta

Programar la llamada desde **Supabase** (`pg_cron` + `pg_net`):

- Gratis en el plan actual, puntual al minuto y dentro del stack (sin proveedor nuevo).
- El secreto va cifrado en **Vault**, nunca en el repo (el repo es público).
- Se descartó **Vercel Cron**: en el plan Hobby solo permite ejecuciones diarias.
- **Alternativas** si `pg_cron` no estuviera disponible: cron-job.org o Cloudflare Workers Cron
  Triggers llamando al mismo endpoint con la cabecera `x-cron-secret`.

## Tickets

- `issues/01-programar-con-pg-cron.md` — aplicar el programador en Supabase, verificar, quitar el
  `schedule` de GitHub y dejar la migración en el repo.
- `issues/02-envio-con-recuperacion.md` — (opcional) que el envío recupere avisos atrasados, para que
  un fallo puntual del programador no se coma el aviso del día.

## Comments
