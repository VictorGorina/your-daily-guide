# 07 — Días futuros: cambiar un plato desde la tira

Status: ready
Blocked by: 01, 02, 03, 04
Tamaño: M
Se despliega junto con: 08

## Qué

Al abrir un día futuro, cada comida lleva un lápiz. El plato cambia al instante, solo ese día, queda
fijado (`pinned`) y se puede deshacer durante unos segundos.

## Por qué

Petición del usuario: "que sean también modificables los platos". Hoy solo se pueden cambiar platos
futuros hablando con el coach. Decisión D2: solo ese día (la compensación va en el 08).

## Diseño

### Quién puede editar qué (puro, en `week-nav.ts`)

`canEditFutureMeal({ date, today, slot, hasDish, isPlanner, sharedSlots })`:
- `date > today`, hay plato;
- si hay hogar y el slot es compartido ese día, solo quien planifica.

Anticipa `guardSharedSlotWrite`; el servidor sigue mandando.

### Panel de día futuro (sustituye a `DayMenu`, web y móvil)

- Filas como `Field` + botón lápiz de 30 px.
- Comida compartida de otra persona: sin lápiz, con "La lleva {nombre}".
- Aviso de ingredientes fuera de la compra (`offListNote`) como ahora.
- Platos de los niños: visibles, sin lápiz (aplazado).
- Sin menú: "Aún no hay menú para este día." Si el mes es `next-unlocked` sin plan, enlace a Plan.

### Sheet

`MealSwapSheet` con prop `mode: "eaten" | "plan"` (web y móvil). En `plan`:
- sin "Me lo salté";
- título "Cambiar la cena · jueves 17";
- placeholder "¿Qué te apetece?", botón "Cambiar plato".

### Mutación

1. Snapshot de `["plan", month]` → `setQueryData` con `withPlanMeal(plan, date, slot, dish, [], {
   pin: true })`. El texto hace fundido cruzado (350 ms).
2. `setPlanMeal({ date, slot, dish, today })`. Móvil: `apiPost("/api/v1/plan/meal")`, guiándose por
   el campo `error` y no por el HTTP 500.
3. Error → restaurar el snapshot + mensaje del servidor (web `toast`, móvil `Alert.alert`, como el
   resto de Hoy).
4. Éxito → **invalidar** `["plan", month]` (no pegar la fila devuelta: H5, `fetchMonthlyPlan`
   compone el hogar) y encolar el cambio en el lote del ticket 08 con `from = previousIdea`.
5. "Deshacer" inline bajo el plato (`text-primary`, zona de toque ≥ 30 px) mientras el lote tenga
   ese cambio pendiente. Pulsarlo → `setPlanMeal({ dish: previousIdea, pin: previousPinned })`, y el
   lote descarta la entrada (08).

### Invariantes

Sin IA en este paso. La compra no cambia. Hoy no pasa por aquí (sigue con `use-meal-swap`).

## Archivos

- `src/lib/week-nav.ts` + test, `mobile/lib/week-nav.ts`
- `src/components/meal-swap-sheet.tsx`, `mobile/components/meal-swap-sheet.tsx`
- `src/components/future-day-menu.tsx`, `mobile/components/future-day-menu.tsx` (nuevos; salen de
  `DayMenu` en `hoy.tsx`)
- `src/routes/_authenticated/hoy.tsx`, `mobile/app/(app)/hoy.tsx`

## Criterios de aceptación

- [ ] Tests `canEditFutureMeal`: planificador, no planificador con slot compartido y no compartido,
      hoy, sin plato.
- [ ] Simulador y navegador (demo): cambiar la cena de pasado mañana → se ve al instante; recargar →
      sigue; "Deshacer" → vuelve al plato original y a su estado de fijado.
- [ ] Un plato con un ingrediente no comprado muestra el aviso y la compra no cambia.
- [ ] Error de servidor simulado → vuelve al plato anterior con mensaje.
- [ ] Deshacer los cambios hechos al perfil demo al terminar.

## Comments
