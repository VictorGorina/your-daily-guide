# 06 — Onboarding: quitar las preguntas que no se ganan su sitio

Status: sin empezar
Incidencia del usuario: ⓼
Blocked by: 04

## Objetivo

Un onboarding más corto sin perder los datos que de verdad cambian algo.

## Contexto y aviso de historia

Recuento actual: **37 preguntas base + hasta 5 follow-ups**, en 6 pantallas
(`src/routes/_authenticated/onboarding.tsx`, con copia propia en
`mobile/app/(app)/onboarding.tsx`).

**Esto revierte una decisión anterior.** En agosto de 2026 el usuario rechazó de plano
recortar el onboarding y se dejó registrado "no volver a proponerlo". El 2026-09-07 pidió lo
contrario: "hay demasiadas preguntas, algunas no ayudan". Leyendo las dos juntas: lo que
rechazó fue vaciar la recogida de datos de golpe (la propuesta de entonces era bajar a ~10 y
diferir el resto), no quitar preguntas concretas.

Por eso: **recortar pregunta a pregunta y con justificación**, no anunciar un objetivo de
número. La memoria `onboarding-direction` ya está actualizada con esta reversión.

## Tareas

1. **Auditoría, una por una.** Criterio de corte: la pregunta se queda solo si su respuesta
   cambia el plan, la lista de la compra o el tono del coach. Rastrear cada campo hasta donde
   se consume (`src/lib/ai-provider.server.ts`, `src/lib/profile-fields.ts`) — si no se lee en
   ningún sitio, sobra.
2. **Candidatas ya detectadas** (verificar antes de cortar):
   - "¿A qué hora sueles despertarte y acostarte?" solapa con la pregunta de horario laboral
     de la misma pantalla.
   - El presupuesto se pregunta **dos veces**: `BUDGET_Q` en "Hacia dónde vamos" y otra vez en
     la última pregunta de "Cómo te acompaño".
   - "Cómo comes hoy" tiene 10 preguntas, la pantalla más cargada con diferencia.
3. **Fusionar en vez de borrar** donde se pueda: dos preguntas cortas en una con dos campos
   cuesta menos que dos pasos.
4. **Presentar la lista al usuario antes de borrar nada.** Es su producto y las preguntas son
   suyas; el recorte se acuerda, no se ejecuta a ciegas.
5. **Móvil**: replicar el recorte final en `mobile/app/(app)/onboarding.tsx`.
6. Repasar que quitar un campo no rompa "Mis respuestas" (`perfil.tsx`) ni la herramienta
   `actualizar_perfil` del chat.

## Verificación

- Pasada completa del onboarding con perfil demo en web y en el simulador iOS.
- Un perfil creado antes del recorte sigue abriendo "Mis respuestas" sin romperse.
- `bun run lint` / `typecheck` / `test` verdes.

## Hecho cuando

El onboarding es más corto, cada pregunta que queda tiene un consumidor identificable, y el
usuario ha dado el visto bueno a la lista de bajas.

## Palanca complementaria (no sustituye al recorte)

El usuario quiere además animación en el onboarding para que se haga más llevadero. La
referencia de diseño es el despiece del onboarding de MyRealFood, guardado como artifact; la
memoria `onboarding-direction` tiene el enlace y la lista "adoptar / evitar".
