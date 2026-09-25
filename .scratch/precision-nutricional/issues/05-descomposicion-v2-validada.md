# 05 — Receta canónica validada: una lectura estructurada, gramos crudos y reglas en código

Status: ready (replanificado el 2026-09-24, D7 y D8)
Blocked by: 14
Tamaño: L
Fase: 2

## Qué

`decomposeDishes` pasa a producir una **receta canónica** por plato:

- ingredientes en **gramos crudos** para 1 ración base (AESAN, punto medio);
- método de cocción y tipo de ración (plato o unidad);
- todo validado por reglas en código antes de darlo por bueno.

Usa **una** lectura con salida estructurada. La conciliación entre varias fuentes (Sonar y juez) pasa
al ticket 20, que solo se hace si el eval lo pide.

## Por qué

- H2, H5, H8 y H18 (lotes que vuelven vacíos sin error).
- La línea base del 02 muestra que el modelo acierta la composición (densidad 5,2 %) y falla la
  cantidad. Con el escalado del 08, la cantidad absoluta del modelo deja de importar para los platos
  planificados: importan las **proporciones**, las omisiones y el aceite. Eso se ataca con reglas en
  código, no con más opiniones del modelo (D7).
- La receta en crudo es la que se pesa y la que se compra (D8, invariante 3). Una sola cifra sirve
  para la receta, las macros y la compra.

## Diseño

### 1. Una lectura, salida estructurada

- `generateObject` + Zod: adiós a `parseJsonLoose` y a los lotes que vuelven vacíos sin error.
- **Modelo:** `DISH_MODEL` (hoy `openai/gpt-5`). El A/B compara con `google/gemini-2.5-flash` (con y
  sin razonamiento) y se queda el más barato que cumpla (memoria `ai-plan-quality-cheap-model`:
  techo de ~1 €/mes; el ahorro nunca justifica peores cifras).
- **Esquema por ingrediente:** `{ nombre, key | null, categoria, gramos_crudo, estado: "crudo" |
  "listo", es_grasa_de_cocinar }`.
- **Esquema por plato:** `{ comida: boolean, vago: boolean, metodo (enum del 14), tipo_racion: "plato" | "unidad",
  unidad?: string ("pizza individual"), cantidad_texto?: number (0,5 para "media pizza") }`.
- Se mantiene la lista `FOOD_KEYS` en el prompt hasta el ticket 04, que hace el casado sin ella.

### 2. Ración base = AESAN 2022, punto medio (decisión del 2026-09-24)

- Anclas en crudo: legumbre seca 60 g · arroz o pasta seca 70 g · carne cruda 110 g · pescado crudo
  135 g · **1 huevo** (50 g comestible) salvo número explícito · pan 50 g · fruta 150 g (como topping,
  60 g) · yogur 125 g · leche 200 ml · frutos secos 25 g · verdura de guarnición 150-200 g.
- El aceite lo pone el código (`OIL_BY_METHOD`, ticket 14).
- Sustituye a la `BASE_RATION` anterior de este ticket (140 g de carne, 2 huevos, 75 g de pasta),
  que contradecía la decisión.
- **Filas crudas:** donde la tabla solo tenga la fila cocinada de un básico (carnes y pescados con
  `cookedYield`), se añade la cruda con su fuente. La tabla generada v2 (03) lo hace de forma
  sistemática después.

### 3. Casado

El de ahora (`resolveIngredient` + las filas del 14). Lo que casa con confianza baja cuenta en
`quality`. El 04 lo mejora (candidatos, ambigüedad, sub-platos).

### 4. `validateRecipe(recipe, dishName, slot) → { recipe, flags, retryHint? }` (puro)

| Regla | Acción |
|---|---|
| **Omisión:** cada alimento nombrado en el título (casado con `foods`) está entre los ingredientes | reintento con pista: "falta el chorizo" |
| **Inventado:** patata o caldo en una crema que no los nombra; fruta entera como topping | recortar a la ancla o quitar + flag |
| **Rango por ingrediente** (`GRAM_RANGES` por alimento o categoría, por ración base): carne o pescado crudo 80-180 g · pasta o arroz seco 40-100 g · legumbre seca 40-90 g · sal ≤ 4 g · frutos secos 10-40 g · queso curado 10-50 g · huevo 1-3 ud | recortar al borde + flag |
| **Aceite:** siempre el de `OIL_BY_METHOD` según `metodo` (sustituye al del modelo) | automático |
| **Masa cruda total** por ración entre 150 y 850 g | reintento con pista |
| **Banda de kcal por comida** (ración base): desayuno 200-550 · comida 400-900 · cena 300-800 · merienda 80-400 | reintento; si persiste, `flag: "fuera_de_banda"` |
| **Fuera de casa** ("menú", "restaurante", "bar") | banda +25 %, sin reintento |

Como mucho un reintento por plato, con todas las pistas juntas.

### 5. Calidad

- `quality` = kcal de ingredientes con confianza alta ÷ kcal totales (ponderada por kcal, ticket 14).
- **Umbral de uso: 0,90.** Por debajo, el plato no se da por calculado. El ingrediente que falla se
  resuelve con el alimento más parecido (13) o con USDA (22), y se vuelve a validar. Nunca se usa con
  un genérico ni con un promedio (D13).
- La revisión manual se prioriza por uso (`hits`, ticket 06).

### 6. Tipo resultante

```ts
type CanonicalRecipe = {
  dishKey: string;
  dishLabel: string;
  ingredients: { foodKey: string; name: string; gramsRaw: number; state: "crudo" | "listo";
                 confidence: "high" | "low" }[];
  method: CookingMethod;       // enum del 14
  servingKind: "plato" | "unidad";
  unitLabel?: string;          // "pizza individual"
  quality: number;             // 0-1, ponderada por kcal
  flags: string[];
  // Reservado para el ticket 20 (fuentes independientes):
  agreement?: number; judged?: boolean; sources?: string[];
  pipelineVersion: number;
  foodsVersion: string;        // hash de foods.data.ts
};
```

## A/B obligatorio antes de dar el ticket por cerrado

`bun run eval:recipes --model …` sobre el mismo golden set con 3 variantes: `openai/gpt-5` (actual),
`google/gemini-2.5-flash` y Flash con razonamiento bajo. Mismas métricas del spec, más el coste por
plato, la latencia P50/P90 y las pasadas sin descomponer.

- Se adopta **la más barata que cumpla**: densidad ≤ 6 %, reparto ≤ 3 pts, proteína ≤ 8 %, omisiones
  ≤ 1 %, sin descomponer ≤ 1 %, sesgo con signo entre −3 % y +3 %.
- Si ninguna cumple en omisiones, densidad o proteína, se apunta y **se desbloquea el ticket 20**.
- El segundo modelo de la cadena del 13 (`DISH_FALLBACK_MODEL`) pasa el mismo eval y tiene que
  cumplir igual.
- Resultados en Comments y enseñados al usuario.

## Archivos

- `src/lib/nutrition/resolve-dish.server.ts` (orquesta)
- `src/lib/nutrition/validate-recipe.ts` + test (puro)
- `src/lib/nutrition/foods.data.ts` (filas crudas de los básicos)
- `src/lib/ai-provider.server.ts` (`DISH_MODEL`, si cambia)
- `src/lib/plan-eval/recipe-accuracy.ts` (`--model`)
- Retirar `eval:dishes` en favor de `eval:recipes`.

## Criterios de aceptación

- [ ] La variante elegida cumple los objetivos de arriba, o el ticket 20 queda desbloqueado con los
      números.
- [ ] Ningún plato del golden set sin grasa cuando su método la pide, ni con aceite distinto del de
      `OIL_BY_METHOD`.
- [ ] Tests puros de cada regla de `validateRecipe`.
- [ ] Una respuesta que no valida con Zod cuenta como plato sin descomponer, con el error registrado
      (test).
- [ ] Coste medido por plato nuevo, apuntado en Comments.

## Comments

- 2026-09-24 — Replanificado tras la auditoría (D7). Las tres lecturas, Sonar y el juez pasan al
  ticket 20, condicionado al eval. La `BASE_RATION` anterior (140 g de carne, 2 huevos, 75 g de
  pasta) se sustituye por el punto medio de AESAN que decidió el usuario. El aceite deja de
  "añadirse si falta" y pasa a ponerlo siempre el código según el método (el error medido es que el
  modelo pone de más). Ya no depende del 04: se queda con el casado actual más las filas del 14.

- 2026-09-24 — Las bandas de kcal por comida y los `GRAM_RANGES` se estrechan respecto al 05
  original porque la ración base pasa a ser la de AESAN (más pequeña que la anterior).

- 2026-09-24 — Tras confirmar D7-D13: respaldo sustituido por la cadena del 13 y USDA (22); `categoria` y `vago` en el esquema (D13).
