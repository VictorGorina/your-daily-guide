# 06 — Onboarding: quitar las preguntas que no se ganan su sitio

Status: hecho (2026-09-07)
Incidencia del usuario: ⓼
Blocked by: 04

## Lo que se hizo

Auditoría campo por campo rastreando cada uno hasta su consumidor real (el
`coachSystemPrompt` de `ai-provider.server.ts`, que comparten coach y generador de
plan; `push-dispatch.server.ts`; `profile-fields.ts`). Resultado: **7 campos se
escribían en el onboarding y no los leía nadie** — `wake_time`, `sleep_time`,
`meals_per_day`, `work_schedule`, `short_term_goal`, `tracking_experience`,
`weigh_in_cadence`.

Decisiones del usuario (2026-09-07) sobre la lista presentada:

- **Cortadas** (pregunta + campo fuera del draft, del save y de "Mis respuestas";
  la columna de BD se deja, no se dropea):
  - "¿A qué hora sueles despertarte y acostarte?" → `wake_time` + `sleep_time`.
    La señal de sueño/ritmo ya entra en `life_context`; las horas operativas se
    piden aparte (resumen mañana/noche).
  - "¿Cada cuánto quieres registrar tu peso?" → `weigh_in_cadence`. No hay ningún
    recordatorio de pesaje que lo use.
  - "¿Tienes algún objetivo a corto plazo para 2-4 semanas?" → `short_term_goal`.
- **Mantenidas pero se mata la columna huérfana** (la pregunta sigue nutriendo un
  campo que sí se lee):
  - "¿Cómo es tu horario laboral o diario?" se queda; `work_schedule` fuera. El
    texto va a `life_context` (se amplió la instrucción del parser a "trabajo y
    horario laboral, turnos o viajes").
  - La pregunta de "qué te ha costado antes / contar calorías" se queda;
    `tracking_experience` fuera, su contenido se funde en `past_struggles` (se
    amplió la descripción del campo en el prompt del parser).
- **`meals_per_day`**: el usuario pidió conservar la pregunta. Para que tenga un
  consumidor, se cableó a `coachSystemPrompt` (línea de "Rutina y horarios de
  comidas": "· Suele hacer N comidas al día").
- **Tabaco y alcohol**: se mantienen los dos (el usuario lo confirmó pese a ser
  señal débil).
- **3 fusiones** (2 pasos → 1, sin perder campos; el parser ya troceaba el blob):
  - "¿Condición médica?" + "¿Medicación/suplementos?" → "¿Alguna condición médica,
    medicación o suplemento que deba tener en cuenta?"
  - "¿Nivel de actividad?" (chips) + "¿Haces ejercicio, tipo y frecuencia?" →
    "¿Cómo describirías tu actividad física habitual y qué ejercicio haces?"
    (texto libre; el parser mapea `activity_level` + `exercise`).
  - "¿Algún alimento que no piensas dejar?" + "¿Ingredientes que no quieres ver?"
    → "¿Hay algún alimento intocable que no piensas dejar, y alguno que no quieres
    ver en tus platos?"

Resultado: **36 preguntas base → 30**, las 6 pantallas siguen (6/4/9/4/4/3). Cada
pregunta que queda tiene un consumidor identificable.

`DRAFT_STORAGE_KEY` subido a `-v2` (web + móvil): el recorte desplaza las claves
posicionales `si-qi`, un borrador a medias del guion viejo restauraría respuestas
en la pregunta equivocada.

## Ficheros tocados

Web: `src/lib/onboarding.functions.ts` (tipo `OnboardingDraft`, prompt y retorno
del parser), `src/lib/ai-provider.server.ts` (`meals_per_day` al prompt),
`src/routes/_authenticated/onboarding.tsx` (SCREENS, `saveAll`, storage key,
copy del intro), `src/lib/profile-fields.ts`, `src/lib/demo-profile.ts`.
Móvil (copias a mano, mismo recorte): `mobile/lib/onboarding.ts`,
`mobile/app/(app)/onboarding.tsx`, `mobile/lib/profile-fields.ts`,
`mobile/lib/demo-profile.ts`.

## Verificado

- `bun run typecheck` / `lint` / `test` (241 pass) verdes; `tsc` de móvil limpio.
- Pasada completa del onboarding en navegador con sesión demo: intro dice "30
  preguntas", el índice confirma 6/4/9/4/4/3, las 3 preguntas fusionadas y la
  ausencia de wake/sleep, corto plazo y cadencia de pesaje comprobadas en pantalla.
  `parseOnboarding` ×2 + `generateMonthlyPlan` + `welcomeBriefing` → 200, pantalla
  final "Tu plan está listo".
- "Mis respuestas" (`/perfil`): ya no aparecen los 5 campos cortados; `meals_per_day`,
  `life_context` y `past_struggles` siguen. Un perfil viejo con esas columnas
  pobladas no rompe (la pantalla itera `PROFILE_SECTIONS`).

## Pendiente / no incluido

- Verificación en el simulador iOS (la copia móvil es port 1:1 y `tsc` pasa; falta
  la pasada visual).
- La "palanca complementaria" (animación del onboarding, referencia MyRealFood) es
  sesión aparte, no entra en este recorte.

---

## Contexto original (antes de implementar)

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
