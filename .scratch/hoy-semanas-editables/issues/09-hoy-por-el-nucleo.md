# 09 — "Comí otra cosa" en Hoy pasa por el núcleo de compensación

Status: ready
Blocked by: 08
Tamaño: S

## Qué

El cambio de plato de hoy deja de decidir la compensación por su cuenta: sigue regenerando la guía
del día, pero la compensación va por `dish-change-batch` → `compensateDishChanges`, con la misma
tabla que el resto.

## Por qué

- D2: todo cambio de plato se analiza igual.
- H7: `use-meal-swap` mide contra `plannedKcal` (congelado con el plato original), así que un
  segundo cambio de la misma comida vuelve a compensar el desvío entero.
- Hoy llama a `adjustMonthlyPlan` **siempre**, también por un cambio parecido; la IA decide si
  compensa "suave". Con la tabla, un cambio parecido no gasta la llamada ni reordena la semana.

## Diseño

En `src/lib/use-meal-swap.ts` y `mobile/lib/use-meal-swap.ts`:

- `swap()` sigue igual en lo inmediato: `setPlanMeal`, `status: "distinto"`, `plannedIdea` y
  `plannedKcal` congelados **solo para pintar** el tachado de Hoy.
- Después de `setPlanMeal`: `enqueueDishChange({ date: hoy, slot, from: previousIdea, to: dish,
  origin: "hoy" })`, en lugar de su lote propio de ajuste.
- La regeneración de la guía de hoy (una llamada por lote) se engancha con `onBatchSettled`, o como
  paso previo del mismo lote si hay cambios de hoy. Mismo `macroEstimate` fijo que ahora.
- Al volver `compensateDishChanges`:
  - `adjusted` → `patchTodayHabits` pone `adjustmentChanges`, `adjustmentSummary` y
    `adjustmentKcal` en las comidas del lote (el badge "i" y `AdjustmentInfoSheet` no cambian);
  - `adjusted: false` → no se escribe ajuste y no sale badge.
- Se eliminan del hook: `noteFor`, la llamada a `adjustMonthlyPlan` y el uso de `kcalDeltaOf` para
  compensar. `kcalDeltaOf` se borra si queda sin uso (y su test).
- El spinner por comida (`isAdjusting`) pasa a leer `useDishChangeBatch().isPending(hoy, slot)`.

## Archivos

- `src/lib/use-meal-swap.ts`, `mobile/lib/use-meal-swap.ts`
- `src/lib/macros.ts` + test, `mobile/lib/macros.ts` (si `kcalDeltaOf` queda sin uso)
- `src/routes/_authenticated/hoy.tsx`, `mobile/app/(app)/hoy.tsx` (solo si cambia la firma del hook)

## Criterios de aceptación

- [ ] Navegador (demo, objetivo perder): cena de hoy → "pizza cuatro quesos" → spinner, luego badge
      "i" con días futuros ajustados; la barra de macros de hoy sube.
- [ ] Cena de hoy → un plato parecido: la guía se regenera, pero sin badge "i" y sin llamada a
      `plan/compensate` que reajuste (comprobar en red: `adjusted: false`).
- [ ] Cambiar la misma cena dos veces en lotes distintos: la segunda compensación usa como `from` el
      plato del primer cambio (comprobar en la petición).
- [ ] Simulador: los mismos tres casos.

## Comments
