# Spec — Nutrición determinista

Status: Fases 0-2 implementadas y verificadas (2026-09-10), sin commitear. Fases 3-5 diferidas.

## Estado tras la primera tanda (2026-09-10)

- **Módulo `src/lib/nutrition/`** hecho: `foods.data.ts` (~205 alimentos), `nutrition.ts`
  (puro, `matchFood`/`macrosOf`/`priceOf`, 15 tests), `resolve-dish.server.ts`
  (`decomposeDishes`, una llamada al modelo, memo por proceso), `index.ts`.
- **`generateDailyGuide`** ya calcula `macroEstimate`/`mealMacros` por lookup en paralelo con
  el texto de la guía; el modelo ya no estima cifras. Respaldo: `roughMealMacros` por tipo de
  comida. Sin migración (la guía ya cachea su resultado en `daily_logs.guide`; la tabla
  `dish_breakdowns` se pospone a la Fase 3).
- **Banco de pruebas** `src/lib/plan-eval/` + `bun run eval:dishes`: 50 platos, **50/50
  descompuestos, 100 % de calidad media, 0 kcal fuera de rango**. `baseline.json` guardado.
- **Verificado en navegador** con perfil demo: la barra de macros de Hoy muestra
  424 kcal / 20 g P / 64 g C / 18 g fibra para "Lentejas estofadas con verduras" y suma
  1296 kcal al marcar las tres comidas — todo del lookup. lint / typecheck / 282 tests en verde.
- **Móvil**: sin cambios (consume `guide.mealMacros` con la misma forma vía `/api/v1/guide`).
Autor: sesión Claude Code, 2026-09-10
Feature slug: `nutricion-determinista`

## Resumen en una frase

El modelo barato (`google/gemini-2.5-flash`) sigue proponiendo platos libremente, pero los
**números** de cada plato (kcal, macros, precio, cantidades de compra) dejan de salir del
modelo y pasan a calcularse en código: descomponer el plato en `{ingrediente, gramos}` con
una llamada barata, buscar cada ingrediente en una tabla de composición estática y sumar.

## Por qué

Un modelo Flash-tier es bueno **descomponiendo** un plato ("shakshuka" → huevo, tomate,
pimiento, cebolla, comino, aceite) — es conocimiento del mundo + lenguaje. Es malo diciendo
"eso son 420 kcal" — es aritmética sobre números memorizados. Hoy le pedimos lo segundo en
tres sitios (`generateDailyGuide` estima `mealMacros` cada mañana, `generatePlanBody`
inventa `weekQty`/`weekPrice`, `enforceBudget` recorta con una 2ª llamada) y de ahí salen:
kcal que bailan de un día a otro para el mismo plato, cantidades de compra irreales, y coste
que no cuadra con el presupuesto.

Restricción dura del proyecto: **no subir de modelo**. La solución es mover a código todo lo
verificable. Ver la memoria `ai-plan-quality-cheap-model`.

## Arquitectura

Módulo nuevo `src/lib/nutrition/`:

| Archivo | Qué es | Modelo |
|---|---|---|
| `foods.data.ts` | Tabla de composición. ~200-300 alimentos de dieta mediterránea. Por fila: `key`, `aliases[]`, kcal/protein/carbs/fat/fiber por 100 g (porción comestible, tal como se come), `densityGPerMl`, `category`, `perishable`, `shelfLifeDays`, `pricePer100Eur` (ES, aproximado, parte mantenida a mano). Estática, commiteada. | — |
| `nutrition.ts` (puro) | `matchFood(name)` (normaliza + alias + solape de tokens + fallback a media de categoría con flag), `macrosOf(ingredients)`, `priceOf(ingredients)`. Sin I/O, sin `*.server`. | — |
| `resolve-dish.server.ts` | `dishToIngredients(dish, servings, ctx)` → `{ ingredients, source }`. Única llamada al modelo, con salida por schema Zod. Cache en tabla `dish_breakdowns` por `hash(dish + servings + locale)`. | Flash (cacheado) |
| `index.ts` | Re-export solo de lo puro (para que la web no arrastre `foods.data` al bundle si no hace falta). | — |
| `nutrition.test.ts` | Platos y alimentos conocidos → kcal/macros esperados con tolerancia. Entra en `bun run test`. | — |

`shelfLifeDays` sustituye poco a poco al `SHELF_LIFE_BY_KEYWORD` de `perishability.ts`
(mismo objetivo, ahora una sola fuente).

## Invariantes

- El módulo puro (`nutrition.ts`, `foods.data.ts`) **nunca** importa `*.server` ni `ai`.
  `resolve-dish.server.ts` sí, y solo se carga con `await import()` desde las functions.
- Las macros son **orientativas por diseño** — el copy que ya lo dice (aviso junto a la barra
  en Hoy, portada) se mantiene. El lookup no las convierte en un conteo clínico.
- El error que queda es la **ración** que estima el modelo, no un número alucinado: es
  sistemático y se acota con anclas de ración en el prompt.
- Fallback en cadena: ingrediente sin match exacto → media de categoría con
  `confidence: "low"`; plato irresoluble → se cae al modelo de la guía como hoy.
- Paridad móvil: las macros viajan por `/api/v1/guide` con la misma forma. El móvil no
  cambia. Verificar Hoy en el simulador tras la Fase 2.

## Fases

- **00** — Banco de pruebas `src/lib/plan-eval/` + línea base. `bun run eval:plan`.
- **01** — Módulo `src/lib/nutrition/`: tabla, funciones puras, `dishToIngredients`, tests.
- **02** — `generateDailyGuide` calcula `macroEstimate`/`mealMacros` por lookup (modelo de
  respaldo). Migración `dish_breakdowns`. Verificar web + móvil.
- **03** *(diferida)* — Lista de la compra y precio derivados de las recetas descompuestas.
  `enforceBudget` sin IA.
- **04** *(diferida)* — Salida del plan por `generateObject`/schema. `reflowMeals` compensa
  en código sobre kcal conocidas; fuera `FORCE_ADJUST_KCAL`.
- **05** *(diferida)* — Prompt-cache, few-shot, `eval:plan` en CI (dispatch manual).

## Decisiones tomadas (mis sugerencias, aprobadas)

1. `foods` vive como **JSON/TS commiteado**, no tabla Supabase — son datos de referencia
   estáticos.
2. Ingrediente fuera de la tabla → **media de categoría + `confidence: "low"`**, no una
   segunda pasada de lookup.
3. `enforceBudget` (Fase 3) → **regla determinista** de bajada por tramo de coste, no una
   llamada a IA.
4. Primera entrega: **Fases 0-2**. Las 3-5 se deciden viendo la mejora medida.

## Comments
