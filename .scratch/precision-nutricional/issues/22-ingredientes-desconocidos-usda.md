# 22 — Ingredientes desconocidos: composición de USDA, nunca un genérico

Status: implementado (2026-09-25, sin desplegar); falta la clave y la migración
Blocked by: 14
Tamaño: M
Fase: 2

## Qué

Cuando un ingrediente no está en la tabla y pesa en kcal, su composición se busca en **USDA
FoodData Central**, una fuente de referencia con API gratuita, en vez de usar el alimento "más
parecido" (13) o un genérico. Se guarda para toda la app y a partir de ahí es una fila más.

## Por qué

- D13: todo plato se calcula de verdad. El "más parecido" del 13 evita el genérico, pero sigue siendo
  una aproximación: la manteca de cerdo se parece al aceite, pero no es aceite.
- D5 ya eligió USDA + CIQUAL como fuente de la tabla. Esto la amplía sola, con trazabilidad, a
  medida que la gente escribe platos.

## Diseño

- **Cuándo:** un ingrediente sin fila en `foods` que aporta ≥ 5 % de las kcal del plato (misma regla
  que el 13).
- **Cómo:**
  1. La descomposición ya da el nombre en español y la categoría. Una llamada barata lo traduce a una
     consulta en inglés para USDA ("manteca de cerdo" → "lard"). Es solo texto, sin cifras.
  2. `GET https://api.nal.usda.gov/fdc/v1/foods/search` con los tipos Foundation y SR Legacy
     (genéricos, no marcas). La clave se guarda en el servidor (`USDA_FDC_API_KEY`); la cuota
     gratuita es de 1.000 peticiones por hora.
  3. Si hay varios candidatos, `gemini-2.5-flash-lite` elige de la lista cerrada (descripciones, sin
     cifras), igual que en el 13.
  4. Se guardan kcal, P, C, G y fibra por 100 g con `source: "usda"` y `sourceId: fdcId` en la tabla
     **`foods_extra`** (global; solo escribe `service_role`, como `dish_recipes`). Se pone
     `reviewed = false` y el alias español.
- **Lectura:** `resolveIngredient` consulta `foods` y después `foods_extra`, en memoria del proceso y
  cargada al arrancar. Las recetas que usaban el "más parecido" se recalculan al leer (las macros
  nunca se guardan, 06).
- **Sin respuesta de USDA** (caída o sin resultados): se queda el "más parecido" del 13. Nunca el
  genérico.
- **Revisión:** `bun run foods:review` lista las filas de `foods_extra` por uso, para pasarlas a
  `foods.sources.csv` (03) o corregirlas. Sustituye a la tabla `unmatched_ingredients` del 04.
- **Productos españoles** sin equivalente en USDA (sobrasada, fuet…): los cubren las filas del 14 y
  del 03 (CIQUAL u Open Food Facts), no esta vía.

## Archivos

- `src/lib/nutrition/usda.server.ts` (búsqueda y elección), `src/lib/nutrition/nutrition.ts` (lectura
  de `foods_extra`)
- Migración `foods_extra`; `scripts/foods-review.ts`; variable `USDA_FDC_API_KEY` (AGENTS.md)

## Criterios de aceptación

- [ ] Test con la API simulada: "manteca de cerdo" → la fila de lard de USDA (~900 kcal/100 g),
      guardada con su `fdcId`.
- [ ] Test: sin respuesta de USDA, el ingrediente usa el "más parecido", nunca el genérico.
- [ ] Una sesión `authenticated` no puede escribir en `foods_extra`.
- [ ] La clave de USDA no aparece en el bundle del navegador.

## Comments

- 2026-09-25 — **Implementado**: `usda.ts` (puro, testeado con la API simulada), `usda.server.ts`,
  migración `20260925150000_foods_extra.sql`, `bun run foods:review`. Pendiente: `USDA_FDC_API_KEY`
  (clave gratuita de api.data.gov; sin ella no se busca) en `.env` y Vercel, y aplicar la
  migración.
