# 10 — `cambiar_plato` del coach pasa por el núcleo de compensación

Status: hecho y verificado en navegador (perfil demo, 2026-09-17). Diseño distinto al de abajo —
leer el comentario antes de tocar este ticket.
Blocked by: 08
Tamaño: S

## Qué

Cuando el coach cambia un plato (de hoy o de un día futuro), el cambio entra en el mismo lote que la
tira y Hoy, y se analiza con la misma tabla. El modelo deja de estimar kcal y de decidir si compensa
un plato concreto.

## Por qué

- D2: "debería compensar cada vez que se cambia un plato".
- H8: ahora el prompt de `/api/chat` pide al modelo que, además de `cambiar_plato`, llame a
  `ajustar_plan_mensual` con un `kcal_extra` estimado por él. Es una cifra del modelo decidiendo una
  compensación, y si solo se añade el análisis automático, se compensaría dos veces.

## Diseño

### Cliente (`src/lib/use-coach-actions.ts` y `mobile/lib/use-coach-actions.ts`)

- `cambiar_plato`, después de `setPlanMeal`: `enqueueDishChange({ date, slot, from: previousIdea,
  to: dish, origin: "coach" })`.
- Si la fecha es hoy: mantener la regeneración de la guía como ahora, y unificar el marcado del
  registro con el de `use-meal-swap` (`plannedIdea` en vez del `wasIdea` legacy), **sin** marcar la
  comida como comida: pedir "quiero X para cenar" no es haberla comido.
- El texto que devuelve la herramienta añade: "Miro si hace falta compensar en los próximos días."
- Resultado del lote con `origin: "coach"`:
  - `adjusted` → se pinta como tarjeta de acción en el chat, reutilizando el aviso que ya enseña
    `ajustar_plan_mensual` ("Días futuros del plan reajustados…"), con "Ver" →
    `AdjustmentInfoSheet`;
  - si es de hoy, además el badge "i" de Hoy (ticket 09).

### Prompt (`src/routes/api/chat.ts`)

- "Qué comió de verdad hoy": quitar "llama TAMBIÉN a ajustar_plan_mensual y recalcular_objetivo por el
  exceso". Queda: `cambiar_plato` con el plato real; la app analiza sola las macros y compensa si hace
  falta. `recalcular_objetivo` solo si la persona pregunta por su objetivo.
- "El plan es vivo": `ajustar_plan_mensual` queda para lo que **no** es un plato concreto (ejercicio,
  picoteo sin detalle, una semana floja).
- Regla explícita: "Nunca llames a ajustar_plan_mensual por un plato que acabas de cambiar con
  cambiar_plato: la app ya lo compensa."

### Cinturón

Si en el mismo turno llegan `cambiar_plato` y `ajustar_plan_mensual` y la nota de este último habla
del mismo plato, el cliente ignora `ajustar_plan_mensual` y lo registra en consola. Es heurística:
se decide en la implementación si compensa mantenerla o basta con el prompt.

## Archivos

- `src/lib/use-coach-actions.ts`, `mobile/lib/use-coach-actions.ts`
- `src/routes/api/chat.ts`
- Componente de tarjeta de acción del coach (web y móvil) si hace falta el "Ver"

## Criterios de aceptación

- [ ] Navegador (demo): "esta noche en vez de la cena quiero una hamburguesa con patatas" → cambia la
      cena de hoy, **no** hay llamada a `plan/adjust`, y a los ~10 s llega `plan/compensate` con
      `adjusted: true`.
- [ ] "El jueves quiero pollo al horno en vez de pechuga" → cambia el jueves, `adjusted: false`, sin
      reajuste.
- [ ] "Hoy he salido a correr una hora" → sigue usando `ajustar_plan_mensual` (no es un plato).
- [ ] Simulador: los mismos casos desde el chat móvil.

## Comments

- 2026-09-17: implementado sin el `dish-change-batch.ts` compartido que preveía el diseño de
  arriba (sigue sin existir — ver el comentario del ticket 08: ni la tira de días futuros ni el
  coach lo necesitaban todavía como para justificar la abstracción). En su lugar:
  - Para HOY: `cambiar_plato` reusa tal cual el camino de Hoy (ticket 09) — calcula el desvío con
    `perMealKcalDeltas` contra la guía regenerada y llama a `compensateDishChanges` sin lote (una
    llamada directa, esperada, en vez del debounce de 10 s de Hoy: el coach ya manda un cambio a
    la vez, no hace falta agrupar).
  - Para un día FUTURO: función nueva `compensateFutureDishChange`
    (`src/lib/plan.functions.ts`, espejo `src/routes/api/v1/plan/compensate-future.ts`). No
    pasa por `habits` (eso es solo de Hoy, que solo existe para el día de hoy) ni acumula entre
    llamadas — decide y aplica en el momento con las macros reales de los dos platos via
    `decomposeDishes` (la misma descomposición de la guía diaria, pero sin atarla a "hoy": ya era
    genérica). Sin cifras fiables de alguno de los dos platos (`quality < 0.4` o `source !==
    "model"`) no compensa a ciegas (`reason: "no-macros"`). La ventana de recolocación es la misma
    `compensationWindow` anclada en HOY (no en el día cambiado): compensar es siempre sobre los
    próximos días reales, igual que el resto de la app, no alrededor del día futuro que se tocó
    (que además ya queda protegido por `pinned`, así que ni falta excluirlo a mano de la ventana).
  - `resolveCompensationGoal(profile)` extraído en `plan.functions.ts` (antes duplicado inline en
    `compensateDishChanges`) para no triplicar la derivación del objetivo.
  - Prompt (`src/routes/api/chat.ts`): el bloque "Qué comió de verdad hoy" ya no pide llamar
    también a `ajustar_plan_mensual`/`recalcular_objetivo` por el mismo plato (H8); "El plan es
    vivo" queda solo para lo que NO es un plato concreto; regla explícita nueva de no llamar a
    `ajustar_plan_mensual` por un plato recién cambiado con `cambiar_plato`. **No** se construyó el
    "cinturón" heurístico de detectar y descartar una llamada duplicada en el mismo turno — el
    prompt ya lo evita en la práctica (verificado abajo) y añadir ese heurístico sin verlo fallar
    de verdad era complejidad de más.
  - Sin tarjeta de acción "Ver" en el chat (`AdjustmentInfoSheet` solo sigue viviendo en Hoy): no
    hay ningún precedente de tarjetas de acción en el chat (ni siquiera `ajustar_plan_mensual` la
    tiene hoy), así que se optó por el mismo texto plano que ya usa `ajustar_plan_mensual`
    ("He ajustado N comida(s)..."), que el modelo lee y parafrasea en su respuesta. Construir la
    tarjeta habría sido una pieza de UI nueva sin ningún otro caso que la justificara todavía.
  - Verificado en navegador con perfil demo anónimo (`isAnonymous: true`, sesión ya abierta):
    - Hoy, vía coach: "esta noche... hamburguesa doble con queso y patatas" → `compensateDishChanges`
      llamado (confirmado por red), mismo comportamiento que el botón directo.
    - Día futuro con delta grande (perfil vegetariano, así que la prueba fue con pizza de queso, no
      con hamburguesa de carne — el coach respeta la restricción del perfil y rechazó la carne
      correctamente): domingo 20 → `pizza cuatro quesos` dio `reason: "no-change"` (el reflow no
      movió nada, plan ya tocado por pruebas anteriores en esos mismos días); martes 22 →
      `pizza cuatro quesos enorme...` dio `adjusted: true`, 2 comidas futuras recolocadas, badge
      "He ajustado 2 comida(s)..." en la respuesta del coach, y el modelo NO llamó también a
      `ajustar_plan_mensual` en el mismo turno (una sola fila de acción).
    - Día futuro con delta pequeño (jueves 24, "garbanzos con verduras" en vez de lo que hubiera):
      `adjusted: false`, sin nota de ajuste, tal como pide el criterio de aceptación.
  - No verificado en simulador iOS (mobile sí lleva el mismo cambio en `use-coach-actions.ts` vía
    `apiPost("plan/compensate-future", ...)`, pero solo se comprobó `bun run typecheck`/lint no
    aplica a mobile del mismo modo — pendiente pasar por el simulador si hace falta blindarlo).
