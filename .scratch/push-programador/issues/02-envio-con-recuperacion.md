# 02 — Envío con recuperación de avisos atrasados (opcional)

Status: deferred
Blocked by: 01
Tamaño: S

## Qué

Que `push-dispatch.server.ts` envíe el aviso de la mañana o de la noche aunque la ejecución llegue
tarde, siempre que no se haya enviado ya hoy y el retraso sea razonable.

## Por qué

Ahora `inWindow` solo acepta horas dentro de los últimos `WINDOW_MINUTES = 20`. Si el programador
falla una sola vez (caída, despliegue, error puntual), ese aviso del día se pierde en silencio. Con
el programador de GitHub se perdía ~90 % de los avisos.

## Diseño

- Sustituir la ventana fija por: `hora elegida ≤ ahora ≤ hora elegida + MAX_LATE_MINUTES` y
  `*_push_sent_on !== hoy`. Propuesta: `MAX_LATE_MINUTES = 90` para la mañana y 60 para la noche
  (un "resumen de la mañana" a mediodía ya no tiene sentido).
- Mantener el cruce de medianoche y la zona horaria de cada persona (`timezone`).
- Respetar las reglas de tono que ya existen (p. ej. "relajado" no manda el aviso de la noche si el
  día está completo).
- Marcar `*_push_sent_on` **antes** de enviar, con un `update … where *_push_sent_on is distinct from
  hoy returning id`, para que dos ejecuciones solapadas no dupliquen el aviso.

## Criterios de aceptación

- [ ] Tests puros de la nueva ventana: a tiempo, con retraso dentro del margen, fuera del margen,
      cruce de medianoche y ya enviado hoy.
- [ ] Dos llamadas simultáneas a `/api/cron/dispatch` no envían el mismo aviso dos veces.
- [ ] `bun run lint`, `bun run typecheck` y `bun run test` en verde.

## Comments
