# 02 — Golden set y eval de exactitud (medir antes de tocar)

Status: ready
Blocked by: —
Tamaño: M (la mitad es trabajo de revisión humana)

## Qué

Un banco de pruebas que mide **cuánto se equivocan** las cifras frente a recetas de referencia, no
solo si caen en un rango. Y una línea base del pipeline **actual**, antes de cambiar nada.

## Por qué

Hallazgo H5. El eval actual (`bun run eval:dishes`) dice "100 % de calidad" con errores del 40-70 %
dentro. Sin una medida de verdad no se puede demostrar que los tickets 03-06 mejoran algo.

## Diseño

### Dos capas de referencia, porque son dos errores distintos

1. **`golden-recipes.data.ts` — error de descomposición.** 70 platos con su receta de referencia
   para **1 ración base**: `[{ foodKey, gramsRaw, method }]`. Las macros de referencia se calculan
   con **la misma tabla** `foods`. Así se aísla el error del modelo (gramos, omisiones, casado) del
   error de la tabla.
2. **`golden-external.data.ts` — error de tabla.** 15-20 alimentos y platos-producto con kcal y
   macros por 100 g de una fuente externa (etiqueta de producto o tabla oficial): salmorejo,
   tortilla de patatas, hummus, croquetas, pizza margarita, pan de pita, bacon, pavo loncheado,
   morcilla, fuet, cerveza, vino, bebida de soja…

### Qué platos

- Sacar los platos **más frecuentes de producción** con una consulta de solo lectura sobre
  `monthly_plans.plan` (almuerzos, cenas, desayunos y snacks). Así el golden set es lo que la app
  propone de verdad.
- Reparto: 15 desayunos, 25 comidas, 20 cenas, 10 meriendas, más 5 típicos de "comí distinto"
  (pizza y cerveza, menú del día, hamburguesa con patatas, bocadillo de tortilla, tapas).
- Claude prepara el borrador de cada receta a partir de recetas españolas publicadas con pesos.
  **Una persona la revisa** antes de darla por buena (campo `reviewedBy`).

### Métricas (`bun run eval:recipes`)

- kcal por ración: error medio absoluto (%) y P90.
- **Densidad energética** (kcal por 100 g de plato): error medio. No depende del tamaño de la
  ración, así que separa "se equivocó en la composición" de "se equivocó en la cantidad".
- Proteína, grasa y carbohidratos por ración: error medio (%).
- Ingredientes principales **omitidos** (en la referencia, ausentes en la salida) e **inventados**.
- Error en gramos del ingrediente principal y del aceite.
- **Determinismo**: 3 pasadas del mismo plato sin caché → desviación típica de kcal.
- **Reparto de macros**: diferencia en puntos del % de kcal que aportan proteína, carbohidratos y
  grasa.
- Top 15 peores platos, con el motivo, en `eval-report.md`.
- **Modo A/B de fuentes** (lo usa el ticket 05): `--sources gemini3 | gemini2+sonar |
  gemini2+sonar+judge`. Mismas métricas por variante, más coste real (tokens y peticiones leídos de
  la respuesta de OpenRouter) y latencia.
- Guarda `baseline-recipes.json` (el eval viejo no se toca hasta el ticket 05).

## Archivos

- `src/lib/plan-eval/golden-recipes.data.ts`, `golden-external.data.ts` (nuevos)
- `src/lib/plan-eval/recipe-accuracy.ts` (nuevo, script)
- `package.json`: `"eval:recipes"`
- Métricas puras (`accuracyOf(reference, output)`) en `src/lib/plan-eval/accuracy.ts` con test en
  `bun run test`.

## Criterios de aceptación

- [ ] 70 recetas + 15 referencias externas, todas con `reviewedBy`.
- [ ] `bun run eval:recipes` corre el pipeline actual y guarda la línea base.
- [ ] La línea base queda copiada en `## Comments` del spec con los números (se espera que sea
      mala: esa es la gracia).
- [ ] `accuracyOf` tiene test; el eval no entra en CI (gasta llamadas).

## Comments
