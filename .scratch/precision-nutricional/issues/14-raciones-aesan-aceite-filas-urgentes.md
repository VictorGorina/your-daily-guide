# 14 — Raciones AESAN, aceite por método y filas urgentes de la tabla (medido con el eval)

Status: implementado en código (2026-09-25, fase 2, sin desplegar); criterios del eval pendientes, ver Comments
Blocked by: — (usa la línea base provisional del 02; se vuelve a medir cuando se fije la definitiva)
Tamaño: M
Fase: 1

## Qué

Corregir en el pipeline actual las tres causas medidas del sesgo de +21,5 %: las anclas de ración,
el aceite y los alimentos mal casados. Todo se demuestra con `bun run eval:recipes` sobre el mismo
golden set antes de darlo por bueno.

## Por qué

- Línea base del 02: el modelo acierta la composición (densidad 5,2 %) y se pasa en la cantidad.
  Por orden de peso en los peores platos: aceite, huevos (2 donde AESAN pone 1), carne (muslo
  +117 % en gramos), pan (60 g frente a 50), fruta de topping entera y patata inventada en las
  cremas.
- Decisión del usuario (2026-09-24): el punto medio de AESAN es la ración de referencia, y alinear
  `RATION_ANCHORS` con él es el arreglo esperado (memoria `reference-ration-aesan-midpoint`).
- H22 y H23: casados erróneos y una fila de salmón incoherente (ver la auditoría).
- Este ticket no espera a la tabla v2 (03) ni a la receta canónica (05). Lo que arregla aquí vale
  para los dos, y las cifras que ve la gente mejoran ya.

## Diseño

### 1. Anclas = AESAN 2022, punto medio

`RATION_ANCHORS` ([resolve-dish.server.ts](../../../src/lib/nutrition/resolve-dish.server.ts)),
dichas como las necesita el modelo (el prompt pide cocido para cereal y legumbre):

- legumbre 60 g en seco ≈ 180 g cocida · arroz 70 g en seco ≈ 195 g cocido · pasta 70 g en seco
  ≈ 165 g cocida. Las conversiones salen de la propia tabla (kcal en seco ÷ kcal cocido).
- carne 110 g en crudo (`wasRaw: true`) · pescado 135 g en crudo · **1 huevo** salvo que el plato
  diga otro número ("tortilla de 2 huevos") · pan 50 g · fruta de postre 150 g; **fruta como topping
  60 g** · yogur 125 g · leche 200 ml · frutos secos 25 g.
- Cremas y purés: la verdura que nombra el plato; **no añadir patata ni caldo** si el nombre no lo
  dice.
- Se quita el aceite de las anclas: lo pone el código (punto 2).

### 2. Aceite por método, en código

- El campo `coccion` pasa de 3 valores a un enum cerrado: `cruda` · `aliñada` · `untada` ·
  `plancha` · `horno` · `salteado` · `guiso` · `hervido` · `frito_rebozado`. El modelo solo
  clasifica.
- `OIL_BY_METHOD` (g por ración; valores iniciales que ajusta el eval): cruda 0 · aliñada 8 · untada
  5 · plancha 5 · horno 8 · salteado 8 · guiso 10 · hervido 0 · frito_rebozado 14 (aceite retenido,
  la tortilla medida con BEDCA).
- **El código sustituye el aceite del modelo** por el de la tabla (× raciones). No se limita a
  añadirlo si falta, porque el error medido es que el modelo pone de más.
- Excepciones:
  - Si el texto dice "sin aceite", "al vapor" o "en freidora de aire", el aceite es 0 o el de la
    plancha.
  - Un plato con dos métodos (ensalada + pollo a la plancha) suma los dos.
- Sustituye a `applyFryingOilFloor` y a `FRYING_OIL_FLOOR_PER_SERVING`.

### 3. Filas urgentes, con fuente trazable

Cada fila nueva lleva en comentario su `source` y su `sourceId` (USDA FoodData Central o CIQUAL;
para productos españoles, la mediana de Open Food Facts, igual que `golden-external.data.ts`):

- **Platos-producto:** `tortilla-patatas`, `croqueta`, `pizza`.
- **Embutidos:** `bacon` (+ panceta), `sobrasada`, `chistorra`. Esta última se queda como alias de
  `chorizo-fresco` si está dentro del ±15 %; si no, fila propia. Y `pechuga-pavo-loncheada`,
  separada de `jamon-cocido` (+25 % en las referencias externas).
- **Desayuno:** `granola`, `muesli`, `cereales-desayuno` (copos de maíz).
- **Despensa:** `leche-condensada`, `harina-garbanzo`.
- **Bebidas:** `bebida-soja` y `bebida-almendra`, separadas de `bebida-avena`.
- **Alias:** `fuet` → `salchichon`.
- **`wrap`:** su label deja de empezar por "tortilla" ("wrap o tortilla de trigo"), para que
  "tortilla francesa" no case con él por la cabecera. La tortilla francesa se descompone en huevo +
  aceite.

### 4. Filas con `cookedYield` coherentes

- Revisar las ~20 filas con `cookedYield` contra su fuente: el valor tiene que ser el **cocinado**.
- `salmon` (208 kcal = valor USDA crudo): o valor cocinado con su `fdcId`, o quitar `cookedYield`.
  Lo que decida el 05 (D8, gramos crudos) manda; aquí solo se evita el −20 % de ahora.
- Test: ninguna fila tiene `cookedYield` sin una nota de fuente que diga "cocinado".

### 5. Calidad ponderada por kcal

- `resolutionQuality` pasa a pesar por kcal, no por gramos.
- El umbral de uso (`0.4` en `macrosFromLookup` y `MIN_QUALITY` en el picoteo) se fija con el eval.
  Orientación: ≥ 0,85.
- Un plato por debajo del umbral no se da por calculado: sigue la cadena del 13 (alimento más
  parecido, reintento con pista). Nunca un genérico ni un promedio (D13).

## Archivos

- `src/lib/nutrition/resolve-dish.server.ts` (anclas, `coccion`, aceite)
- `src/lib/nutrition/foods.data.ts` (filas, alias, `wrap`, `cookedYield`)
- `src/lib/nutrition/nutrition.ts` (`resolutionQuality`), `src/lib/guide.functions.ts`,
  `src/lib/snacks.functions.ts` (umbrales)
- `src/lib/nutrition/nutrition.test.ts`: fixture con los nombres de H22 → fila esperada

## Criterios de aceptación

- [ ] `bun run eval:recipes` sobre el mismo golden set: el sesgo con signo baja de +21,5 % a
      **|≤ 8 %|**, el error medio por ración de 23,2 % a **≤ 12 %**, y la densidad no empeora
      (≤ 6 %). La comparación va en `## Comments` y se le enseña al usuario (memoria
      `macro-accuracy-foundation`).
- [ ] Capa externa: casado correcto ≥ 85 % (antes 64,7 %), sin filas que falten de las 5 medidas.
- [ ] Test: `matchFood` de cada nombre de H22 → la fila esperada.
- [ ] Test: `OIL_BY_METHOD` sustituye al aceite del modelo; "sin aceite" da 0.
- [ ] Test: el plato con manteca de la auditoría ya no pasa el umbral con calidad alta.

## Comments

- 2026-09-24 — Tras confirmar D7-D13: se despliega junto con el 21 y el 23 (ver el spec).

- 2026-09-25 — **Aplazado a propósito** al hacer el resto de la fase 1. Se despliega con el 21 y el
  23 (ver arriba): un commit a `main` despliega, y las anclas de AESAN con un plato por comida
  dejarían el día corto. Además, sus filas nuevas necesitan `source`/`sourceId` verificables y la
  comparación de `eval:recipes`, que no se han hecho. Lo que el 13 ya cubre de su terreno: un
  ingrediente sin casar cae en su categoría (la manteca ya no vale 130 kcal/100 g).

- 2026-09-25 — **Implementado junto con el 05** (el pipeline pasa a crudo, así que el 14 se hizo
  directamente sobre la receta canónica, sin una versión intermedia en cocido). Anclas AESAN en
  crudo en el prompt; `OIL_BY_METHOD` en `cooking.ts` (sustituye a la grasa del modelo; de dos
  métodos de calor cuenta el mayor, el aliño se suma, el untado solo sin calor: el eval midió
  13 g frente a 3 g en un revuelto sobre tostada al sumar); filas nuevas con fuente trazable
  (bacon, sobrasada, pavo loncheado, tortilla de patatas, pizza, croquetas, granola, copos de
  maíz, harina de garbanzo, bebidas de soja y almendra, leche condensada; filas en seco de arroz
  integral, pasta integral, quinoa, cuscús y alubias); fuet → salchichón; wrap sin "tortilla" en
  cabeza; tortilla francesa → huevo. §4: campo `basis` en cada fila con `cookedYield`; salmón,
  merluza, caballa, mejillones y calamar eran valores CRUDOS (el salmón sin rendimiento, porque
  USDA da casi lo mismo cocinado). §5: calidad por kcal y umbral 0,90 (`MIN_RECIPE_QUALITY`).
  Pendiente: chistorra y muesli sin fuente fiable (Open Food Facts no tiene chistorra etiquetada y
  la categoría de muesli devolvía la de granola); verificar con USDA los `fdcId` de la patata
  (170026 / 170438) y del salmón crudo (175167) cuando haya clave propia.

- 2026-09-25 — **Eval (`eval:recipes`, mismo golden set, GPT-5, 3 pasadas), segunda iteración:**

  | Métrica | Línea base | 1.ª iteración | 2.ª iteración | Criterio |
  |---|---|---|---|---|
  | Sesgo de kcal con signo | +21,5 % | +9,8 % | **+6,6 %** | ≤ ±8 % ✓ |
  | kcal por ración, error medio | 23,2 % | 14,9 % | **10,8 %** | ≤ 12 % ✓ |
  | kcal por ración, P90 | 44,5 % | 35,7 % | **25 %** | — |
  | Densidad (kcal/100 g) | 5,2 % | 10,9 % | **12,6 %** | no empeorar ✗ |
  | Proteína por ración | 23,3 % | 12,5 % | **10,4 %** | — |
  | Omitidos | 9,2 % | 12,7 % | **8,7 %** | — |
  | Casado de la tabla | 64,7 % | 94,1 % | **100 %**, 0 filas que faltan | ≥ 85 % ✓ |
  | Sin descomponer | 24/225 | 6/225 | **1/225** | — |

  Entre las dos iteraciones: grasa de dos métodos sin sumar, un huevo si acompaña, dos bases de
  hidrato que se reparten la ración y el líquido de guisos en el prompt. La densidad empeora sobre
  todo por la masa de líquido de cremas y guisos (−22 % a −29 % en esos platos), que apenas mueve las
  kcal por ración; no se ha cambiado la métrica para taparlo. Desde esta iteración el líquido
  (caldo o agua) cuenta como un mismo ingrediente en la comparación de omisiones.
