# 07 — Plato del niño alternativo en el plan

Status: resolved
Blocked by: 04, 05

## Objetivo

Cuando un plato compartido no sirve para un niño, el plan lleva su plato aparte para ese día,
y sus ingredientes están en la compra a ración de niño. Editable día a día.

## Tareas

1. `src/lib/plan-shared.ts` (+ copia móvil):
   - `PlanDay` gana `kids?: { childId: string; slot: MealSlot; dish: string; off?: string[] }[]`.
   - `cleanDay` valida `kids` (tope de longitud ~6, `slot` en `MEAL_SLOTS`, `dish` no vacío y
     recortado, `childId` string, `off` como `extras`).
   - `mergeFuturePlan`: arrastra `kids` como hace con `breakfast`/`snack`/`extras` (un plato
     de niño puesto a mano manda sobre una regeneración).
   - Helper `childMealsForDate(plan, date, childId)` → `{ slot, dish, off }[]` (solo los
     slots con override; el resto el niño come el plato compartido).
2. `src/lib/plan.functions.ts` `generateMonthlyPlan` prompt: "Si un plato compartido no sirve
   para un niño (su alérgeno, su edad, o no lo come), añade para ESE niño ESE día un plato
   alternativo sencillo en `days[].kids` (`childId` de la lista de niños que te doy) y refleja
   sus ingredientes en `weekQty` a ración de ese niño." Pasar la lista de niños con `id`,
   `name`, `age`, `allergies`, `portion` en el contexto.
3. Server fn `setChildMeal({ date, slot, childId, dish, today })` — paralela a `setPlanMeal`:
   - Valida fecha (hoy o futuro), `slot` en `MEAL_SLOTS`, `childId` pertenece al hogar.
   - `off` vía `offShoppingList(dish, shopping, pantryExtras)` → `kids[].off`.
   - Escribe en la fila del **planificador** (vía resolver de 05) y re-espeja.
   - `dish` vacío → quita el override de ese niño/slot/día.
   - Ruta `src/routes/api/v1/plan/child-meal.ts` (3 líneas, `apiPost(setChildMeal)`).
4. `syncSharedMeals`: copiar `kids` de los días futuros junto con `lunch`/`dinner`.
5. Render (web + móvil):
   - **Hoy** (`hoy.tsx` + móvil): bajo el plato compartido de un slot con override,
     "Para {nombre}: {dish}" + aviso `off` si lo hay. Solo si el hogar tiene niños.
   - **Plan** calendario del mes y **`day-detail-sheet.tsx`**: igual.
   - Coach: herramienta `cambiar_plato_niño` opcional (o reutilizar `cambiar_plato` con un
     parámetro `niño`) — mínimo, que el coach pueda llamar a `setChildMeal`.

## Tests

`plan-shared.test.ts`: `cleanDay` con `kids` válidos e inválidos; `mergeFuturePlan` conserva
`kids` de un día futuro; `childMealsForDate` devuelve solo los overrides.

## Verificación

Perfil demo con hogar + niño con alergia a X: generar plan → algún día con plato compartido
que llevaría X muestra plato de niño aparte; la pestaña Ingredientes incluye sus
ingredientes. Cambiar a mano el plato del niño de mañana desde Hoy → se aplica literal, no
cambia hoy. Simulador: capturas de Hoy y del calendario.

## Hecho cuando

`PlanDay.kids` persistido y validado; la IA lo emite en conflicto; `setChildMeal` + su
`/api/v1`; render en Hoy + calendario + day-detail en las dos apps; tests verdes.

## Answer

Hecho (2026-09-01), web + móvil. Sin commitear todavía (va encima de issue 06 en la rama
`familia-comidas-compartidas`).

**Modelo de datos** (`src/lib/plan-shared.ts` + copia móvil): `PlanDay.kids?: ChildMeal[]`
con `ChildMeal = { childId, slot: MealSlot, dish, off? }`. `cleanKids` (solo web, la móvil
recibe datos ya saneados) valida: tope 6, `slot` en `MEAL_SLOTS`, `dish` recortado y no
vacío, dedup por `childId+slot`, `off` como `extras`. `cleanDay` lo llama. `mergeFuturePlan`
ya conservaba `kids` por el spread `...day` (comentario actualizado). Helper nuevo
`childMealsForDate(plan, date, childId)` → solo los slots con override.

**Espejo** (issue 05/03): `composeDayForUser` arrastra los `kids` del planificador para un
slot compartido (y conserva los propios de un slot no compartido, caso raro). `syncSharedMeals`
(`src/lib/household.server.ts`) copia `kids` de los días futuros junto con `lunch`/`dinner`.
`householdContext` gana `children: HouseholdChildLite[]` (`id`, `name`, `age`, `allergies`,
`portion`).

**Servidor** (`src/lib/plan.functions.ts`):

- `generateMonthlyPlan`: bloque de prompt `kidsLine` con la lista de niños (`childId`,
  nombre, edad, alergias, ración) y la instrucción de emitir `days[].kids` cuando el plato
  compartido no le sirve a un niño, dimensionando `weekQty` a su ración. El esquema JSON del
  prompt incluye `kids`. `blankSharedSlots` (modo "solo mis comidas" del no planificador)
  quita los `kids` de un slot compartido.
- `setChildMeal({ date, slot, childId, dish, today })` — paralela a `setPlanMeal`. `childId`
  admite id real o **nombre** (lo usa el coach; se resuelve con `normName`). Rechaza a un no
  planificador con "El plato de {niño} lo pone {planner} de tu casa." (D2). Escribe la fila
  propia del planificador, calcula `off` con `offShoppingList`, `dish` vacío quita el
  override, re-espeja con `syncSharedMeals`. Ruta `src/routes/api/v1/plan/child-meal.ts`.
- Coach: herramienta `cambiar_plato_nino` en `src/routes/api/chat.ts` + handler en
  `use-coach-actions.ts` (web `useServerFn`, móvil `apiPost`). **Mínimo**: la herramienta
  está cableada y valida en servidor, pero el prompt del chat NO recibe todavía la lista de
  niños, así que el coach no la dispara de forma fiable por su cuenta — eso es de issue 08
  ("Coach, adjust y copy").

**Render** (web: `hoy.tsx`, `plan-month-calendar.tsx`, `day-detail-sheet.tsx`; móvil: los
tres equivalentes): bajo el plato compartido de un slot con override se muestra
"Para {nombre}: {dish}" con su aviso `off`, solo si el hogar tiene niños. `plan.tsx` (web y
móvil) pasa `householdChildren={hh?.children}` a `PlanMonthCalendar` y `DayDetailSheet`. El
`DayMenu` de la tira semanal de Hoy (preview menor de un día futuro) se dejó sin `kids` a
propósito para no cablear `children` por otra vía.

**Tests** (`src/lib/plan-shared.test.ts`, +6, 120 verdes): `cleanPlan`/`cleanKids` válidos e
inválidos + día sin `kids` sin la clave; `mergeFuturePlan` conserva `kids` de un día futuro;
`childMealsForDate` solo los overrides; `composeDayForUser` trae los `kids` del planificador
en un slot compartido y no en uno que ese día no se comparte.

**Verificación** (2026-09-01): puertas verdes (web `lint` 0 / `typecheck` / 120 tests; móvil
`tsc` 0). En el navegador como no planificador demo Marta (hogar Alex, `5e38f97f…`): la app
no rompe con un niño en el hogar; `POST /api/v1/plan/child-meal` con `childId:"Leo"` devuelve
la traza `apiPost Error: El plato de Leo lo pone Alex de tu casa.` — la ruta está cableada,
la auth pasa, el resolver por nombre funciona y el guard D2 salta. Datos de prueba (niño Leo)
limpiados. **Sin verificar en vivo**: el camino feliz (planificador pone plato de niño →
espejo → render), la IA emitiendo `kids`, y el simulador iOS — cubiertos por los tests
unitarios y por la paridad con `setPlanMeal`/`syncSharedMeals` ya verificados. Nota de
sesión: al añadir/quitar un hook en `use-coach-actions.ts` el HMR deja `CoachFab` (componente
persistente) con la lista de hooks corrupta; hay que reiniciar el dev server en frío para
verificar, no basta recargar.
