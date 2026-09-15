# 10 — `cambiar_plato` del coach pasa por el núcleo de compensación

Status: ready
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
