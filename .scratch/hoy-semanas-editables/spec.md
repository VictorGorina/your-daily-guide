# Spec — Hoy: semanas navegables y platos editables

Status: decisiones cerradas (2026-09-15; D1 y D2 ampliadas y umbrales aprobados el mismo día).
Tickets 01, 02 y 03 resueltos; 04 listo para empezar.
Feature slug: `hoy-semanas-editables`
Relacionada con: `.scratch/precision-nutricional/` (tickets 01, 06, 07 y 12; ver "Encaje con
precision-nutricional").

## En una frase

La tira de la semana de Hoy se desliza hacia semanas anteriores y siguientes con una animación
limpia. Desde cualquier día se puede editar: en un día pasado se corrige lo que se comió (con un
lápiz visible que lo deja claro y macros reales de lo corregido) y en un día futuro se cambia el
plato del plan. **Cualquier cambio de plato**, venga de la tira, de "Comí otra cosa" en Hoy o del
coach, pasa por el mismo análisis de macros en código y, si supera la tabla de umbrales según el
objetivo, se compensa en otras comidas futuras.

## Estado actual (2026-09-16)

| | Web | Móvil |
|---|---|---|
| Tira | Solo la semana actual, rejilla fija de 7 ([week-strip.tsx](../../src/components/week-strip.tsx)) | Carrusel de semanas con chevrons, etiqueta, píldora "Hoy" y anillo animado (ticket 03, [week-pager.tsx](../../mobile/components/week-pager.tsx); sustituye a `week-strip.tsx`, borrado) |
| Día pasado | `DayDetailBody` inline; se edita tocando la fila entera, sin pista visible | Igual |
| Hoy / futuro | `DayMenu` de solo lectura | Igual |
| Librerías disponibles | `embla-carousel-react`, `motion` | `react-native-reanimated` 4.5 (sin gesture-handler ni haptics) |

Hallazgos que condicionan el diseño:

- **H1 — Dos operaciones, no una.** Pasado = corregir el registro (`updateLogByDate`, rechaza
  `date >= hoy`). Futuro = cambiar el plan (`setPlanMeal`, rechaza `date < hoy`).
- **H2 — Corregir un día pasado no mueve sus kcal.** "Comí: pizza" suma las macros del plato
  planificado (`sumDoneMacros` solo mira `guide.mealMacros` por momento).
- **H3 — Un plato puesto a mano en comida o cena no está protegido.** `applyPlanChanges` y
  `mergeFuturePlan` sobrescriben `lunch`/`dinner` sin mirar si se eligieron a mano; solo desayuno y
  merienda sobreviven (la IA no los devuelve). Ya pasa hoy con `cambiar_plato` del coach en días
  futuros; con la tira, cambiar comidas y cenas futuras se vuelve habitual.
- **H4 — Límite de relleno.** La policy `insert recent own log` solo deja crear un registro de los
  últimos 45 días. Un día más antiguo sin registro no se puede rellenar.
- **H5 — La lectura del plan compone el hogar.** `fetchMonthlyPlan` mezcla las comidas compartidas
  del planificador para un no planificador: tras guardar hay que invalidar y releer, no pegar la
  fila que devuelve el servidor.
- **H6 — Móvil no tiene toasts** (usa `Alert.alert`): el "Deshacer" va inline, en las dos
  plataformas.
- **H7 — Hoy puede compensar dos veces el mismo cambio.** `use-meal-swap` mide el desvío contra
  `plannedKcal`, que se congela con el plato original del día. Cambiar la cena a las 13:00 (se
  compensa) y otra vez a las 20:00 vuelve a compensar el desvío entero contra el plan original.
- **H8 — El coach compensa a ojo.** `cambiar_plato` solo cambia el plato. El prompt de `/api/chat`
  pide al modelo que llame además a `ajustar_plan_mensual` con un `kcal_extra` estimado por él. Si
  se añade la compensación automática sin tocar el prompt, se compensa dos veces.

## Decisiones (cerradas el 2026-09-15)

- **D1 — Corregir un día pasado recalcula las macros de ese día**, con la fuente de macros vigente.
  Ampliada el mismo día: las correcciones de **ayer y anteayer** también pasan por la compensación
  (misma tabla, solo días posteriores a hoy). Las más antiguas son solo historial y nunca recolocan
  el plan (ticket 11).
- **D2 — Cambiar un plato cambia solo ese plato, y todo cambio se analiza.** Ampliada por el usuario:
  "debería compensar cada vez que se cambia un plato, debería analizar el cambio de macros y según tu
  tabla modificar el plan". Vale para la tira, para "Comí otra cosa" en Hoy y para `cambiar_plato`
  del coach, de hoy o de un día futuro. El plato elegido nunca se toca al compensar.
- **D5 — Umbrales aprobados** tal cual la tabla de "Compensación de todo cambio de plato".
- **D3 — No hay artboard en Claude Design.** Se diseña con los tokens y la §7 (movimiento) de
  `docs/design-guidelines.md`.
- **D4 — Háptica al cambiar de semana: aplazada.** Gusta la idea; requiere `expo-haptics` y
  recompilar. Ver "Aplazado".

## Diseño

### Navegación

- Límite hacia atrás: la semana de `profiles.app_started_on`. Los días de esa semana anteriores al
  alta van apagados, sin semáforo y sin poder tocarse.
- Límite hacia delante: la semana del último día de `planNavBounds(today, appStartedOn).latest` (mes
  actual, o el siguiente si está desbloqueado; mismo criterio que Plan).
- Cabecera: `‹  Semana pasada · 7–13 sep  ›` con chevrons (≥ 30 px de toque) y una píldora "Hoy" que
  aparece solo fuera de la semana actual.
- Al cambiar de semana, si el día abierto no está en ella, el panel se pliega.

### Qué pasa al tocar un día

| Tipo de día | Casilla | Panel |
|---|---|---|
| Antes del alta | Apagada, no pulsable | — |
| Pasado editable | Semáforo + lápiz que aparece con pop al seleccionarla | `DayDetailBody` con un botón lápiz por comida |
| Pasado no editable (> 45 días y sin registro) | Semáforo, sin lápiz | Una línea explicando por qué no se puede rellenar |
| Hoy | Oscura, como ahora | Sin cambios |
| Futuro con menú | Neutra | Menú con un lápiz por comida (salvo comidas compartidas de otro planificador) |
| Futuro sin menú | Neutra | "Aún no hay menú para este día" |

### Movimiento (una sola curva: `cubic-bezier(.22, 1, .36, 1)`)

| Momento | Móvil | Web | Duración |
|---|---|---|---|
| Deslizar semana | `FlatList` horizontal `pagingEnabled` (paginado nativo de UIKit) | Embla: arrastre 1:1, encaje al soltar | La del gesto |
| Chevrons / "Hoy" | ≤ 2 semanas: desplazamiento animado; más lejos: fundido 180 ms + salto | Igual | — |
| Etiqueta de semana | `FadeIn`/`FadeOut` + 6 px en la dirección | `AnimatePresence` | 200 ms |
| Anillo del día seleccionado | Valor compartido `x` + `withTiming` | `layoutId` | 350 ms |
| Lápiz en la casilla | Pop .94 → 1.04 → 1 | `animate-pop` | 350 ms |
| Panel del día | `LinearTransition` de altura + fundido y 12 px desde el lado del día tocado | `layout` + `AnimatePresence mode="popLayout"` | 350 ms |
| Plato cambiado | Fundido cruzado del texto | Igual | 350 ms |
| Reducir movimiento | `useReducedMotion`: solo fundidos | Igual | — |

Requisitos para que se vea limpio:

- **Sin salto inicial.** Móvil: la `FlatList` se monta tras medir el ancho en `onLayout`, con
  `getItemLayout` + `initialScrollIndex`. Web: el SSR pinta el carril ya desplazado
  (`translate3d(-N·100%)`) para que Embla arranque donde ya está.
- **Gestos sin conflicto.** Móvil: `directionalLockEnabled` en el `ScrollView` de Hoy. Web:
  `touch-action: pan-y pinch-zoom` en el viewport de Embla.
- **Render por ventana:** solo la semana visible ±2 pinta casillas; el resto son huecos del mismo
  tamaño.

### Compensación de todo cambio de plato (D2, D5)

Un solo camino para todas las entradas:

| Entrada | Hoy | Con este spec |
|---|---|---|
| Tira, día futuro | No existe | `setPlanMeal` → lote común (ticket 08) |
| Hoy, "Comí otra cosa" | `use-meal-swap`: regenera la guía y **siempre** llama a `adjustMonthlyPlan` con Δ contra el plan original (H7) | Regenera la guía igual; la compensación pasa al lote común (ticket 09) |
| Coach, `cambiar_plato` (hoy o futuro) | Cambia el plato; el modelo decide aparte si llama a `ajustar_plan_mensual` con kcal a ojo (H8) | `setPlanMeal` → lote común; el prompt deja de pedir `ajustar_plan_mensual` por un plato concreto (ticket 10) |
| Corrección de ayer o anteayer ("Comí distinto") | Solo historial | Lote común con `kind: "eaten"`; compensa en días posteriores a hoy (ticket 11). Más atrás, solo historial |

El camino:

1. El cambio se aplica al instante (`setPlanMeal`, sin IA) y queda **fijado** (`PlanDay.pinned`,
   ticket 02).
2. Se encola en **un único lote** (`dish-change-batch`) con `{ date, slot, from, to }`, donde `from`
   es el plato que había **justo antes** de ese cambio (`previousIdea`), no el original del plan. Así
   un segundo cambio del mismo plato solo compensa la diferencia nueva (corrige H7). 10 s de calma,
   persistido y forzado al ocultar la app (misma forma que `use-meal-swap.ts` y `plan-recalc.ts`).
   Mientras el cambio está pendiente, la fila muestra "Deshacer" inline donde aplique.
3. El lote hace **una** llamada a `compensateDishChanges`: el servidor calcula en código el desvío
   de kcal y proteína (fuente de macros vigente), decide con `compensationNeed` si hay que compensar
   según el objetivo y, si hace falta, delega en el núcleo de reajuste con las fechas cambiadas
   bloqueadas.
4. El resultado se enseña donde se hizo el cambio: el panel del día en la tira, el badge "i" de la
   fila en Hoy, o la respuesta del coach.

Umbrales aprobados (una sola constante, con tests):

| Objetivo | Más kcal que el plato sustituido | Menos kcal | Proteína |
|---|---|---|---|
| Perder | compensa desde +200 | compensa desde −400 | compensa desde −20 g |
| Mantener / sin objetivo | ±200 | ±200 | −20 g |
| Ganar | compensa desde +400 | compensa desde −200 | −20 g |

- 200 kcal = `FORCE_ADJUST_KCAL`, el "desvío grande" que ya usa la app.
- Un cambio a favor del objetivo tiene más margen (400), pero no ilimitado: el reajuste nunca deja un
  déficit > 500 kcal/día.
- Embarazo o lactancia (`pregnancy_status`): nunca se compensa a la baja.

## Encaje con precision-nutricional

- **Fuente de macros.** D1 y D2 calculan con la fuente vigente a través de **un único punto de
  entrada** (`computeDishMacros`). Hoy usa `decomposeDishes`; cuando llegue su ticket 06 (receta
  canónica), cambia ese punto y nada más.
- **Núcleo de reajuste.** La compensación (ticket 08) no crea un mecanismo nuevo: llama a
  `reflowMeals`. Cuando llegue su ticket 12 (`distributeDelta` sobre raciones), la delegación cambia
  ahí; `compensationNeed`, el lote y la UI se quedan. Su ticket 12 debe respetar las fechas
  bloqueadas y los `pinned`.
- **Preferencia de cifras.** Si su ticket 01 ya está, el aviso de compensación y el detalle respetan
  `showsNutritionNumbers` (sin kcal con `ocultar`).

## Invariantes

1. Hoy y los días pasados nunca se recolocan; la compensación solo toca días posteriores a hoy.
2. La lista de la compra nunca cambia por editar un plato ni por compensar.
3. Un plato elegido a mano (`pinned`) no lo pisa ninguna recolocación automática.
4. Las comidas compartidas solo las cambia quien planifica; la regla de servidor
   (`guardSharedSlotWrite`) manda, la UI solo la anticipa.
5. El modelo nunca decide si hay que compensar: lo decide `compensationNeed` en código.
6. Paridad web/móvil: toda operación nueva tiene su ruta `/api/v1/*`; cada ticket se hace primero en
   móvil y se verifica en el simulador.
7. Verificación en navegador solo con el perfil demo.
8. **Todo cambio de plato pasa por `compensateDishChanges`.** Ninguna ruta llama a
   `adjustMonthlyPlan` por un cambio de plato concreto; `ajustar_plan_mensual` queda para eventos sin
   plato (ejercicio, picoteo sin detalle, una semana floja).

## Tickets y orden

```
01 helpers de semana ──┬──► 03 carrusel móvil ──► 04 carrusel web ──► 05 lápiz días pasados ──► 06 macros día pasado
                       │                                   │                                        │
02 plato fijado ───────┴───────────────────────────────────┴──► 07 cambiar plato futuro ══ 08 núcleo de compensación
                                                                                               │
                                                         ┌─────────────────────┼─────────────────────┐
                                                         ▼                     ▼                     ▼
                                               09 Hoy por el núcleo   10 coach por el núcleo   11 ayer/anteayer por el núcleo
                                                         └─────────────────────┼─────────────────────┘
                                                                               ▼
                                                                  12 verificación + docs
```

- **07 y 08 se despliegan juntos**: 07 sin 08 dejaría cambios futuros sin compensar (va contra D2).
- 09, 10 y 11 pueden ir por separado tras 08; cada uno cierra una entrada que hoy compensa distinto
  o no compensa.
- 01, 02 y 03-06 entregan valor por separado.

## Aplazado

- Háptica (`expo-haptics`, `selectionAsync`) al encajar una semana nueva en móvil (D4).
- Editar el plato aparte de un niño desde la tira (`setChildMeal`). El plato de un niño no cambia
  las macros de un adulto, así que no pasa por la compensación.

## Documentación que hay que actualizar al cerrar

CLAUDE.md (nueva sección "Tira de la semana"; corregir el párrafo de "cambio a mano" con `pinned`;
reescribir "Cambiar un plato en Hoy" para el lote común), AGENTS.md y `docs/agents/testing.md`
(tabla de tests).

## Comments
