# 02 — `generateDailyGuide`: macros por lookup

Status: done (2026-09-10)
Blocked by: 01

## Qué

`generateDailyGuide` ([src/lib/guide.functions.ts](../../../src/lib/guide.functions.ts)) deja
de pedir `macroEstimate`/`mealMacros` al modelo. En su lugar:

1. Para cada plato real de hoy (`todayMeals`), `dishToIngredients(dish, portionOf(profile))`
   → `macrosOf`. Eso da un `MealMacroEstimate` por `moment`.
2. `macroEstimate` = Σ de los `mealMacros`.
3. Si un plato queda `unresolved`, ese `moment` no entra; si **todos** quedan sin resolver,
   se cae al modelo para las macros como hoy (respaldo, no camino principal).
4. El modelo de la guía sigue generando `intro`/`calories`/`macros`/`behaviors`/`meals`/
   `tips` (texto). El prompt pierde toda la parte de pedir cifras.

Ventaja lateral: `mealMacros` de un mismo plato es **constante** día a día (hoy el modelo lo
reestima cada mañana y baila). El `needsMacroRegen` de Hoy (web y móvil) se dispara mucho
menos.

## Ración

`portionOf(profile)` sale de `portions_per_meal` / raciones del hogar. Para la guía basta la
ración del propio usuario (1 por defecto). No mezclar con las raciones compartidas del hogar
aquí — eso es de la Fase 3 (compra).

## Migración

`supabase/migrations/<ts>_dish_breakdowns.sql`: tabla cache. Sin RLS de usuario (es un cache
global de "plato → ingredientes", no lleva datos personales); solo `service_role` escribe
desde las functions.

## Paridad móvil

`mobile/app/(app)/hoy.tsx` y `mobile/lib/macros.ts` consumen `guide.mealMacros` /
`guide.macroEstimate` con la misma forma → **no cambia**. Verificar en el simulador:
generar guía, marcar comidas, la barra de macros suma. Confirmar que `MacroEstimate` de
`mobile/lib/daily.ts` sigue casando con la de `src/lib/guide.functions.ts`.

## Verificación

- Web: preview con perfil demo, pestaña Hoy, generar guía, ver que la barra de macros tiene
  cifras razonables y suma al marcar comidas.
- `bun run lint` / `typecheck` / `test`.
- Simulador iOS: misma comprobación en Hoy.

## Hecho cuando
Las macros de Hoy salen del lookup en web y móvil, con el modelo solo de respaldo, y las
tres puertas estáticas pasan.
