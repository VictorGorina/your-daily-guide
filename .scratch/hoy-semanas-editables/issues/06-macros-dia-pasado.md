# 06 — Macros reales al corregir un día pasado

Status: ready
Blocked by: 05
Tamaño: M

## Qué

Cuando se corrige una comida pasada a "Comí distinto: pizza", las macros de ese día pasan a contar
la pizza, no el plato planificado. Decisión D1: sí, y sin recolocar días futuros.

## Por qué

Hallazgo H2. `sumDoneMacros` ([macros.ts:27](../../../src/lib/macros.ts)) suma
`guide.mealMacros[momento]`, que es el plato del plan. La barra de "Macros del día" del detalle dice
"~X kcal de lo que comiste ese día" y no es verdad. La precisión de las cifras es la base de la app
(memoria `macro-accuracy-foundation`).

## Diseño

### Servidor

- `computeDishMacros({ moment, dish })` en `src/lib/guide.functions.ts`: **punto único** para las
  macros de un plato suelto. Reutiliza `macrosFromLookup([{ moment, idea: dish }])`.
  - Bucket de cuota `guide`.
  - Devuelve `MealMacroEstimate | null`: `null` si la descomposición no es fiable (no se devuelve
    `roughMealMacros`, que haría como si se supiera).
  - Cuando llegue `precision-nutricional/06` (receta canónica), se cambia aquí y en ningún otro sitio.
- Espejo HTTP: `src/routes/api/v1/guide/dish-macros.ts`.

### Registro

- `DailyLog.habits[i].actualMacros?: MealMacroEstimate`: las macros de lo que se comió de verdad.
  **No** se toca `guide.mealMacros` ni `guide.macroEstimate` (el objetivo del día no se mueve).
- `sumDoneMacros`: con `status === "distinto"` y `actualMacros` usa esas; si no, lo de siempre. Si se
  vuelve a "Comí esto" o "Me lo salté", `actualMacros` se ignora (y se limpia al guardar).
- `patchLogHabitsByDate(date, fn)` en `src/lib/daily.ts` (y móvil): relee la fila justo antes de
  escribir, como `patchTodayHabits`. Las macros llegan segundos después del guardado y no deben
  pisar otra corrección hecha mientras tanto.

### Flujo en `DayDetailBody`

1. Guardar la corrección como ahora (instantáneo).
2. Si el estado es `distinto` con texto → `computeDishMacros` en segundo plano; mientras tanto,
   `Loader2` pequeño junto a "Macros del día".
3. Al volver → `patchLogHabitsByDate` pone `actualMacros` a esa comida si su `actual` sigue siendo el
   mismo texto → invalidar `["logs"]`.
4. Si falla o devuelve `null`: sin aviso intrusivo; la barra sigue con lo planificado y una nota
   pequeña "Sin cifras para «pizza»".

## Archivos

- `src/lib/guide.functions.ts`, `src/routes/api/v1/guide/dish-macros.ts`
- `src/lib/daily.ts`, `mobile/lib/daily.ts` (`DailyLog`, `patchLogHabitsByDate`)
- `src/lib/macros.ts` + `src/lib/macros.test.ts`, `mobile/lib/macros.ts`
- `src/components/day-detail-sheet.tsx`, `mobile/components/day-detail-sheet.tsx`

## Criterios de aceptación

- [ ] Tests `sumDoneMacros`: `distinto` con `actualMacros` las usa; `plan` las ignora; `distinto`
      sin `actualMacros` usa lo planificado.
- [ ] Navegador (demo): ayer, cena "Comí distinto: pizza cuatro quesos" → a los pocos segundos la
      barra del día sube y la nota de kcal cambia; volver a "Comí esto" la devuelve.
- [ ] Simulador: igual.
- [ ] Dos correcciones seguidas en el mismo día no se pisan.

## Comments
