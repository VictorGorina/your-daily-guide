# 07 — Plato del niño alternativo en el plan

Status: todo
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
