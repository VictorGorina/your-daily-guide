# 03 — Lista de la compra y precio derivados (DIFERIDA)

Status: deferred — decidir tras medir Fases 0-2

## Qué

`generatePlanBody` deja de pedir `shopping` al modelo; devuelve solo `plan`.
`deriveShoppingList(plan, servings, coverage, cadence)` construye la lista canónica:
cada plato → `dishToIngredients` a las raciones del hogar → agrega por ingrediente sobre las
4 semanas → `ShoppingItem` con `weekQty` (Σ gramos) y `weekPrice` (`priceOf`).
`projectTrips` no se toca.

`enforceBudget`: fuera la llamada a IA. Mientras `total > presupuesto`, baja el plato más
caro por una alternativa elegible más barata (regla por tramo de coste). `scaleShoppingToBudget`
sigue de suelo final.

`PlanDay.extras` (avisos de ingrediente no comprado): diferencia de conjuntos en código.

## Riesgo
Es el cambio más grande y toca la superficie más verificada (plan + compra + móvil). No
entrar sin la línea base de la Fase 0 y sin las macros ya estables (Fase 2).
