# 05 — Receta canónica: fuentes independientes, conciliación y validación

Status: ready
Blocked by: 04
Tamaño: L

## Qué

Rehacer `decomposeDishes` para que cada plato nuevo dé una **receta canónica** (gramos crudos para 1
ración base) contrastada con **fuentes independientes**: dos lecturas de Gemini y una receta
publicada que encuentra Perplexity Sonar con búsqueda web. Un juez de otra familia interviene solo
si no coinciden. Todo casado con `foods` y pasado por reglas de validación en código antes de darlo
por bueno.

## Por qué

Hallazgos H2, H3, H5 y H8, más el estándar "platos perfectamente calculados" del spec. Después de
arreglar la tabla, los errores grandes que quedan son los gramos (sobre todo el aceite) y los
ingredientes que faltan. Tres lecturas del **mismo** modelo comparten sus errores; una receta real
publicada, no.

## Diseño

### 1. Tres lecturas en paralelo

| Lectura | Modelo | Qué le pedimos |
|---|---|---|
| A | `google/gemini-2.5-flash`, temperatura 0,2 | descomponer el plato para 1 ración base |
| B | `google/gemini-2.5-flash`, temperatura 0,6 | lo mismo, con otra redacción del prompt (orden de anclas distinto) para decorrelacionar |
| S | `perplexity/sonar` (búsqueda web) | buscar 2-3 recetas **españolas publicadas con pesos** de ese plato; devolver sus ingredientes en gramos, las raciones de cada receta y las URLs. Normalizamos nosotros a 1 ración |

- A y B por `generateObject` + Zod (Gemini admite salida estructurada en OpenRouter).
- S no la admite: `generateText` → `parseJsonLoose` → el **mismo** schema Zod. Si no valida o no
  trae ninguna URL, la lectura S cuenta como ausente.
- Esquema por ingrediente: `{ nombre, gramos_crudo, estado: "crudo"|"listo", metodo, categoria,
  es_grasa_de_cocinar }`. S añade `{ raciones_receta, fuentes: string[] }`.
- **Se quita la lista `FOOD_KEYS` del prompt**: el casado lo hace el código (ticket 04).
- Llamada a Sonar por OpenRouter con el mismo `createAiProvider`: no hay integración nueva.

### 2. Ración base (en código)

`BASE_RATION` = ración de un adulto de referencia de ~2.000 kcal. Anclas **en crudo** por ración:
pasta o arroz seco 75 g · legumbre seca 70 g (o 200 g de bote) · carne o pescado crudo 140 g ·
huevos 2 ud · verdura de guarnición 200 g · patata cruda 200 g · pan 50 g · aceite de guiso o sofrito
10 g · aceite de aliño 8 g · fruta 150 g · yogur 125 g · frutos secos 25 g.

Las recetas de S se normalizan a 1 ración dividiendo por `raciones_receta`. Si la masa resultante se
aleja más del 40 % de la mediana de A y B, se reescala S a esa mediana **conservando sus
proporciones**: de S interesa sobre todo la composición.

### 3. Casado

Cada lectura se casa con `foods` (ticket 04). Lo `ambiguous` va a **una** llamada de desambiguación
por lote con `google/gemini-2.5-flash-lite` ("elige el número del alimento, o 0"), con 5 candidatos
por label y estado, **sin cifras**. Lo `isDish` se descompone como sub-plato, a un solo nivel.

### 4. Conciliación en código — `reconcile(readings) → { recipe, agreement, needsJudge }` (puro)

Se agrupan los ingredientes por `food.key` (o por categoría si cayeron en respaldo).

- **Presencia:** entra si está en ≥ 2 de las 3 lecturas.
- **Gramos:** mediana de las lecturas que lo tienen.
- **Hay desacuerdo** (→ juez) si pasa alguna de estas:
  - un ingrediente que aporta ≥ 50 kcal está en una sola lectura, o falta en una sola;
  - la densidad energética (kcal por 100 g) de las lecturas difiere más de un 12 % entre la mayor y
    la menor;
  - el reparto de macros (% de kcal de P, C y G) difiere más de 5 puntos en alguno;
  - las kcal del aceite difieren más de 60 kcal.
- `agreement` (0-1) se guarda con la receta: sirve para priorizar la revisión manual.

### 5. Juez (solo con desacuerdo) — `openai/gpt-5-mini`

- Recibe el nombre del plato, las 3 lecturas ya casadas (label y gramos), las URLs de S y los
  motivos del desacuerdo.
- Devuelve por ingrediente `{ incluir: boolean, gramos, motivo }` por salida estructurada.
- **Límite duro en código:** los gramos del juez se recortan al rango `[mín, máx]` de las lecturas
  para ese ingrediente. No puede inventar una cantidad que ninguna fuente dio. Un ingrediente que
  ninguna lectura tenía no puede entrar.
- Alternativa en el A/B: `deepseek/deepseek-v3.2` (más barata, sin razonamiento).

### 6. `validateRecipe(recipe, dishName, slot) → { recipe, flags, retryHint? }` (puro)

| Regla | Acción |
|---|---|
| **Omisión:** cada alimento nombrado en el título (casado con `foods`) está entre los ingredientes | reintento con pista: "falta el chorizo" |
| **Rango por ingrediente** (`GRAM_RANGES` por alimento o categoría, por ración base): aceite 3-25 g · carne o pescado crudo 80-220 g · pasta o arroz seco 40-120 g · legumbre seca 40-110 g · sal ≤ 4 g · frutos secos 10-50 g · queso curado 10-60 g | recortar al borde + flag |
| **Grasa de cocinar:** plancha, salteado, sofrito, horno o guiso sin grasa | añadir aceite por defecto (plancha 5 g, salteado 8 g, guiso 10 g) + flag |
| **Fritura** | añadir `fatAbsorbedPer100g × gramos / 100` de aceite |
| **Masa cruda total** por ración entre 150 y 850 g | reintento con pista |
| **Banda de kcal por comida** (ración base): desayuno 250-650 · comida 450-1000 · cena 350-900 · merienda 100-450 | reintento; si persiste, `flag: "fuera_de_banda"` |
| **Fuera de casa** ("menú", "restaurante", "bar") | banda +25 %, sin reintento |

El reintento repite **solo las lecturas A y B** con todas las pistas juntas (no se paga otra
búsqueda) y vuelve a conciliar con la S original. Como mucho un reintento por plato.

### 7. Calidad

- `quality` = kcal de ingredientes con confianza alta ÷ kcal totales (ponderada por kcal).
- **Umbral de uso: 0,90.** Por debajo, esa comida usa `roughMealMacros` y la receta se marca para
  revisión.
- **Sin fuente independiente** (S ausente y sin juez): se guarda con `flag: "una_fuente"` y cuenta
  como pendiente de revisión, aunque se use.

### Tipo resultante

```ts
type CanonicalRecipe = {
  dishKey: string;
  dishLabel: string;
  ingredients: { foodKey: string; name: string; gramsRaw: number; method: Method;
                 confidence: "high" | "low" }[];
  quality: number;          // 0-1, ponderada por kcal
  agreement: number;        // 0-1, acuerdo entre lecturas
  judged: boolean;
  sources: string[];        // URLs de recetas publicadas (lectura S)
  flags: string[];
  pipelineVersion: number;
  foodsVersion: string;     // hash de foods.data.ts
};
```

## A/B obligatorio antes de dar el ticket por cerrado

`bun run eval:recipes --sources …` (ticket 02) con tres variantes sobre el golden set:

1. `gemini3`: 3 lecturas de Gemini, sin Sonar ni juez.
2. `gemini2+sonar`: A + B + S, sin juez (con desacuerdo, mediana).
3. `gemini2+sonar+judge`: el diseño completo (y una pasada con DeepSeek V3.2 como juez).

Se adopta **la variante más barata que cumpla los objetivos** del spec. Resultados (métricas, coste
por plato, latencia P50/P90) apuntados en Comments. Si ninguna los cumple, se para y se decide con
los números delante.

## Archivos

- `src/lib/nutrition/resolve-dish.server.ts` (orquesta)
- `src/lib/nutrition/sources/gemini.server.ts`, `sonar.server.ts`, `judge.server.ts` (nuevos)
- `src/lib/nutrition/reconcile.ts` + test (puro)
- `src/lib/nutrition/validate-recipe.ts` + test (puro)
- `src/lib/ai-provider.server.ts`: constantes `RECIPE_READER_MODEL`, `RECIPE_GROUNDED_MODEL`,
  `RECIPE_JUDGE_MODEL`, `RECIPE_MATCH_MODEL` (un único sitio para cambiar de modelo)
- Retirar `eval:dishes` en favor de `eval:recipes`.

## Criterios de aceptación

- [ ] Con la variante elegida: kcal por ración con error medio ≤ 6 % y P90 ≤ 12 %; densidad ≤ 6 %;
      reparto de macros ≤ 3 puntos; proteína ≤ 8 %; omisiones ≤ 1 %.
- [ ] El juez nunca da gramos fuera del rango de las lecturas (test).
- [ ] Ningún plato del golden set sin grasa cuando su método la pide.
- [ ] Tests puros de `reconcile` (cada disparador de desacuerdo) y de cada regla de `validateRecipe`.
- [ ] Coste medido por plato nuevo ≤ 0,02 $ y apuntado en Comments.
- [ ] Una respuesta inválida de Sonar no rompe nada: la lectura cuenta como ausente (test con
      respuesta falsa).

## Comments
