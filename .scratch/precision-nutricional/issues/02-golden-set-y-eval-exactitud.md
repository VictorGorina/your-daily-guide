# 02 — Golden set y eval de exactitud (medir antes de tocar)

Status: en curso (2026-09-24). Hecho: métricas, `bun run eval:recipes` (con tests), las 75 recetas y las 17 referencias externas en borrador (todas válidas, `reviewedBy: null`). Línea base provisional fijada (copiada en el spec). Falta: revisión humana y volver a fijar la línea base con las recetas revisadas.
Blocked by: —
Tamaño: M (la mitad es trabajo de revisión humana)
Fase: 0 (base de medida de todas las fases)

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

- 2026-09-24 — Primera mitad hecha (sin llamadas al modelo). Decisiones de diseño:
  - **La referencia apunta lo que se PESÓ y cómo** (`state: "crudo" | "cocinado"`), no la base de
    la tabla. `toTableBasis` la convierte a la tabla vigente igual que `resolveIngredient`
    convertiría una respuesta perfecta (seco → fila cocida con el factor kcal seco / kcal
    cocido; carne y pescado crudos × `cookedYield`). Así el golden set sobrevive al paso a
    crudo del ticket 03 sin tocarlo, y el error medido es del modelo, no de incoherencias
    entre filas. Un test comprueba que esa conversión coincide con la del pipeline (`wasRaw`).
  - Solo 4 alimentos tienen pareja seco/cocido (`DRY_TO_COOKED`). Quinoa, cuscús, alubias y
    arroz/pasta integrales solo existen cocidos (`COOKED_ONLY`): pesarlos en crudo es un error
    de validación, no una conversión silenciosa.
  - "Principal" = ≥ 10 % de las kcal o ≥ 20 % de la masa (la masa cuenta para no ignorar el
    calabacín de una crema). Macros con suelo de 5 g para no inflar el error de valores diminutos.
  - `--save-baseline` fija `baseline-recipes.json`; sin él, el informe compara con la base.
  - Coste por llamada: pendiente para el ticket 05 (con `userId: null` no hay middleware de
    gasto que lo lea); de momento se mide la latencia.

- 2026-09-24 — **Platos elegidos** con una consulta agregada de solo lectura a producción (62
  planes; solo la columna `plan`, solo platos presentes en ≥ 2 planes distintos). La variedad
  real es estrecha y muy redundante en la redacción ("Lentejas estofadas / guisadas / con
  verduras"): se elige un concepto por grupo. "Cena fuera", "Menú del trabajo" y similares no
  son platos y no entran. Desayunos y meriendas con ≥ 2 planes no llegan a 15 y 10: se completan
  con el banco de `dishes.data.ts`.
- 2026-09-24 — **Ración base = AESAN 2022 a mitad de rango** (ver cabecera de
  `golden-recipes.data.ts`). Choca con `RATION_ANCHORS` del prompt en carne (130 g *cocinados* ≈
  173 g en crudo frente a 100-125) y arroz (150 g cocido ≈ 54 g en seco frente a 60-80).
- 2026-09-24 — **Primer lote (12 recetas, borrador sin revisar), GPT-5, 2 pasadas:** kcal por
  ración 24,1 % de error medio con **sesgo +22,5 %**; densidad 6,6 %; CV entre pasadas 2,1 %.
  Lectura: el modelo acierta la composición (densidad casi en objetivo) y se pasa en la cantidad,
  que sale de las anclas del prompt (pechuga, pan, frutos secos, patata) y del suelo de 25 g de
  aceite para fritos. La tortilla de patatas con BEDCA da ~14 g de aceite retenido por ración
  (~145 kcal/100 g), no los 190-220 kcal/100 g que justificaron el suelo. Pendiente de revisión:
  atún "a secas" (al natural en la referencia; el modelo usa en aceite), tamaño de ración de las
  cremas, y "frutos secos" (el modelo elige `nuez`, la referencia `frutos-secos-mix`).
- 2026-09-24 — Fallo de disponibilidad, no de exactitud: 3 de 10 llamadas por lotes de
  `decomposeDishes` devolvieron el lote entero sin descomponer y sin registrar error. El eval ya
  las excluye de las métricas y las cuenta aparte. Diagnóstico propuesto como tarea separada.
- 2026-09-24 — **Decisión del usuario: ración base = mitad del rango de AESAN**, no el extremo
  alto. El sesgo de +22 % se trata como error del sistema que hay que corregir (empezando por
  alinear `RATION_ANCHORS` con AESAN), no como una elección válida dentro del rango.
- 2026-09-24 — **Golden set completo en borrador**: 75 recetas (15/25/20/10 + 5 de "comí
  distinto"; un test lo comprueba) y 17 referencias externas. Fuentes verificadas leyendo cada
  página; donde no hay receta con pesos que respalde las cifras, la fuente dice `CONVENCION`
  ("sin fuente: composición convencional, revisar a mano"). Esas son las primeras que hay que
  revisar: sopa de verduras, pizza casera y los cinco de "comí distinto".
- 2026-09-24 — **Referencias externas**: 6 genéricos de USDA FoodData Central (cada uno con su
  `fdcId`) y 11 productos españoles con la MEDIANA de las etiquetas de Open Food Facts de esa
  categoría (10-30 productos cada uno). Error de la tabla, sin llamadas: los genéricos van en
  0-2 % de kcal; el producto español falla (salmorejo +47 %, morcilla +46 %, hummus −36 %, pavo
  +25 %) y hay 5 filas que faltan (`tortilla-patatas`, `croqueta`, `bacon`, `pizza`,
  `bebida-soja`); el fuet solo necesita un alias en `salchichon`. `matchFood` casa "croquetas de
  jamón" con `jamon-serrano` y "bebida de soja" con `bebida-avena`. Si no casa ninguna fila, el
  error se mide contra `GENERIC_FOOD`, que es lo que sumaría producción.

- 2026-09-24 — Replanificación tras la auditoría: la línea base provisional sirve ya para medir los
  tickets 14 y 13 (raciones AESAN, aceite y filas; pasadas sin descomponer). La revisión humana
  sigue siendo necesaria antes de cerrar el 05. Métricas nuevas en el spec: sesgo con signo (entre
  −3 % y +3 %) y pasadas sin descomponer (≤ 1 %). El 05 necesita `--model` para su A/B.
