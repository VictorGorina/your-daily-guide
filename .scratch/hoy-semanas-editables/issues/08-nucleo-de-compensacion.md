# 08 — Núcleo de compensación para todo cambio de plato

Status: ready
Blocked by: 02, 06, 07
Tamaño: M
Se despliega junto con: 07

## Qué

Un único camino que analiza en código el cambio de macros de cualquier cambio de plato y, según la
tabla de umbrales aprobada, modifica otras comidas futuras para compensar en la línea del objetivo.
En este ticket lo usa la tira (días futuros); los tickets 09 y 10 pasan Hoy y el coach por él.

## Por qué

Decisiones D2 y D5 (memoria `manual-dish-change-compensation`): "debería compensar cada vez que se
cambia un plato, debería analizar el cambio de macros y según tu tabla modificar el plan". Ahora
cada entrada compensa a su manera (H7, H8) o no compensa (la tira no existe).

## Diseño

### Regla pura: `compensationNeed` (`src/lib/nutrition/compensation.ts`, sin `foods`)

```ts
compensationNeed({ deltaKcal, deltaProtein, goal, pregnancyStatus })
  → null | { kcalDelta: number; proteinDelta: number | null }
```

| Objetivo | Compensa si Δkcal ≥ | Compensa si Δkcal ≤ | Proteína |
|---|---|---|---|
| `perder` | +200 | −400 | Δproteína ≤ −20 g |
| `mantener` / sin objetivo | +200 | −200 | Δproteína ≤ −20 g |
| `ganar` | +400 | −200 | Δproteína ≤ −20 g |

- Constantes en `COMPENSATION_THRESHOLDS` (aprobadas por el usuario, D5). 200 = `FORCE_ADJUST_KCAL`.
- `pregnancy_status` embarazada o lactancia: con Δkcal < 0 nunca compensa quitando.
- `goal` sale de `deriveGoalType(actual, objetivo)` o del objetivo legacy, igual que `reflowMeals`.

### Lote en cliente: `src/lib/dish-change-batch.ts` (+ `mobile/lib/dish-change-batch.ts`)

Misma forma que `use-meal-swap.ts` / `plan-recalc.ts`, pero **uno solo para toda la app**:

- Estado a nivel de módulo; clave `${date}:${slot}` → `{ date, slot, from, to, origin }`.
  - `from` = plato que había **justo antes** del primer cambio de esa clave dentro del lote
    (`previousIdea` de `setPlanMeal`). Nunca el original congelado del día (corrige H7).
  - `to` = último plato elegido.
  - `origin`: `"strip" | "hoy" | "coach"`, solo para decidir dónde enseñar el resultado.
- `to === from` (Deshacer, o volver al plato de antes) → se borra la entrada.
- 10 s de calma, persistido en `localStorage` / `AsyncStorage`, forzado al ocultar la app
  (`visibilitychange` / `AppState`) y relanzado al volver a Hoy.
- API:
  - `enqueueDishChange(change)`;
  - `onBatchSettled(listener)` para que Hoy haga su parte (ticket 09);
  - hook `useDishChangeBatch()`: `isPending(date, slot)`, `isRunning`, `lastResult(date)`.

### Servidor: `compensateDishChanges({ today, changes })`

1. Validar: fechas ≥ hoy, slots válidos, como mucho 20 cambios.
2. Cuota `plan-adjust`, una vez por lote.
3. Macros de todos los `from` y `to` en **una** llamada a través de `computeDishMacros` (ticket 06,
   en lote). Un cambio sin cifras fiables de alguno de los dos platos no cuenta (no se compensa a
   ciegas con `roughMealMacros`).
4. Agrupar por mes; sumar Δkcal y Δproteína.
5. `compensationNeed(...)`. `null` → `{ adjusted: false }`.
6. Si hace falta → `reflowMeals` con parámetros nuevos:
   - `lockedDates`: las fechas cambiadas (hoy ya está siempre cerrado);
   - `window`: de `max(hoy + 1, D − 3)` a `D + 6` dentro del mes de D; si queda vacío, el resto de
     días futuros del mes; si tampoco hay, `{ adjusted: false, reason: "no-days" }`;
   - `kcalDelta` y `proteinDelta` (línea nueva en la REGLA 3 del prompt);
   - `note`: "Ha elegido «X» en vez de «Y» para la cena del jueves 17".
   - Los `pinned` (ticket 02) y las comidas compartidas de un no planificador ya están protegidos.
7. Devolver `{ adjusted, reason?, changes: diffFutureMeals(antes, después, today), summary,
   kcalDelta, byChange: [{ date, slot }] }`.
8. Espejo: `src/routes/api/v1/plan/compensate.ts`.

Cuando llegue `precision-nutricional/12`, el paso 6 delega en `distributeDelta` en vez de en la IA;
el resto no cambia. Ese ticket debe respetar `lockedDates` y `pinned`.

### UI (tira)

- Fila del plato cambiado mientras está en el lote: "Deshacer" (ticket 07); `Loader2` pequeño con
  "Ajustando el plan…" mientras el lote está en vuelo.
- `adjusted`: línea en el panel de ese día, "He ajustado 2 comidas para compensarlo · Ver" →
  `AdjustmentInfoSheet` (ya existe en web y móvil) con `changes` y `kcalDelta`.
  - Con `showsNutritionNumbers === false` (si `precision-nutricional/01` ya está): sin kcal.
- `no-days`: "No quedan días este mes para compensarlo."
- Invalidar `["plan"]` al terminar.

## Archivos

- `src/lib/nutrition/compensation.ts` + test
- `src/lib/dish-change-batch.ts`, `mobile/lib/dish-change-batch.ts`
- `src/lib/plan.functions.ts` (`compensateDishChanges`; `reflowMeals` con `lockedDates`, `window`,
  `proteinDelta`)
- `src/lib/guide.functions.ts` (`computeDishMacros` en lote)
- `src/routes/api/v1/plan/compensate.ts`
- `src/components/future-day-menu.tsx`, `mobile/components/future-day-menu.tsx`

## Criterios de aceptación

- [ ] Tests `compensationNeed`: cada fila de la tabla en su límite (199/200, −399/−400), proteína,
      embarazo, sin objetivo.
- [ ] Test (parte pura de `reflowMeals`): filtrado de fechas editables con `lockedDates` y `window`.
- [ ] Test del lote (puro): `from` se queda con el primer plato de la clave; volver a `from` borra la
      entrada.
- [ ] Navegador (demo, objetivo perder): cena de pasado mañana "ensalada" → "hamburguesa con patatas"
      → tras ~10 s aparece "He ajustado N comidas" en días de la ventana; la cena elegida sigue
      igual; hoy, el pasado y la compra no cambian.
- [ ] "pechuga a la plancha" → "pollo al horno": no se compensa ni se gasta la llamada de reajuste.
- [ ] Deshacer dentro de los 10 s: no se llama a `compensateDishChanges`.
- [ ] Cerrar la app dentro de la ventana y volver: el lote se manda.
- [ ] Simulador: los mismos casos principales.

## Comments

- 2026-09-16 (feature `picoteo-hoy`): `compensationNeed` + `COMPENSATION_THRESHOLDS` ya existen en
  `src/lib/nutrition/compensation.ts` (con tests), igual que `compensationWindow` en
  `plan-shared.ts` y los parámetros `window` / `soloOnly` de `reflowMeals`. Este ticket los
  reutiliza. Ojo: devuelve `{ compensate: false, reason }` o `{ compensate: true, kcalDelta,
  proteinDelta }` en vez de `null`. Corrección del texto de arriba: con embarazo o lactancia lo que
  nunca se hace es QUITAR energía, es decir, no se compensa un Δkcal > 0 (un Δ < 0 sí se repone).

