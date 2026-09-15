# Spec — Precisión nutricional

Status: decisiones cerradas (2026-09-15). Tickets 01-06 listos para empezar; 07-12 desbloqueados
en cuanto terminen sus dependencias.
Feature slug: `precision-nutricional`
Sucede a: `.scratch/nutricion-determinista/` (sus Fases 0-2 están hechas; las Fases 3-5 quedan
absorbidas aquí, en los tickets 10-12).

## En una frase

Cada cifra de kcal y macros de la app sale de **una receta canónica pesada en crudo**. Esa receta se
contrasta con varias fuentes independientes (dos lecturas de Gemini y una receta publicada que
encuentra Sonar con búsqueda web, más un juez de otra familia si no coinciden), la validan reglas en
código, se guarda una sola vez para todo el mundo y la comparten Hoy, la receta, el plan, la compra y
el reajuste. Después, las cantidades se **escalan en código al objetivo energético** de cada persona.
En las comidas compartidas del hogar, la ración es la misma para todos los adultos.

## El estándar: platos perfectamente calculados

Requisito del usuario: los platos tienen que estar **perfectamente calculados**. Operativamente eso
significa que se cumplen las cinco cosas a la vez:

1. **Trazable:** cada cifra se puede reconstruir desde la receta guardada (ingredientes, gramos
   crudos, fuentes consultadas) y desde una fila de `foods` con su `source` y `sourceId`.
2. **Contrastado:** ninguna receta se guarda con una sola opinión. Tiene que haber acuerdo entre
   fuentes independientes o, si no, la decisión de un juez limitada al rango de esas fuentes.
3. **Validado:** pasa todas las reglas de `validateRecipe` (omisiones, rangos, grasa de cocinar,
   masa, banda de kcal).
4. **Medido:** el golden set demuestra el error (objetivos de la tabla de abajo) y se vuelve a medir
   con cada cambio del pipeline.
5. **Revisado:** los platos más usados los revisa una persona a mano (`reviewed`).

Lo único que queda fuera del sistema es la variación del alimento real y lo que cada uno se sirve
(±10-20 %). El aviso "estimación orientativa" se refiere solo a eso.

## Fuentes de error y dónde se atacan

| # | Fuente de error | Tamaño típico | Ticket |
|---|---|---|---|
| 1 | Ración igual para todo el mundo, sin objetivo personal | ±30-50 % | 07, 08 |
| 2 | Valores crudos y cocinados mezclados | ±25-40 % en carne, pescado, cereal y legumbre | 03, 05 |
| 3 | Grasa de cocinar (aceite) mal estimada | ±100-200 kcal por plato | 05 |
| 4 | Ingrediente casado con el alimento equivocado | puntual, hasta ±70 % | 03, 04 |
| 5 | Ingrediente omitido o gramos de memoria del modelo | ±10-30 % | 05 (fuentes independientes) |
| 6 | El mismo plato da cifras distintas según el día | variable | 06 |
| 7 | La compra se recorta en cantidad para cuadrar el presupuesto | lo que haga falta | 11 |
| 8 | Valor de la tabla frente al alimento medio | ±5-10 % | 03 |
| 9 | El alimento real y lo que se sirve cada uno | ±10-20 % | irreducible; copy |

## Criterios de éxito (medibles)

| Métrica | Hoy | Objetivo |
|---|---|---|
| kcal por ración frente a la receta de referencia (golden set) | sin medir | error medio ≤ 6 %, P90 ≤ 12 % |
| kcal por 100 g de plato (densidad) | sin medir | error medio ≤ 6 % |
| reparto de macros (% de kcal de P/C/G) | sin medir | ≤ 3 puntos de media |
| proteína por ración | sin medir | error medio ≤ 8 % |
| ingredientes principales omitidos | sin medir | ≤ 1 % |
| mismo plato → mismas cifras | no garantizado | 100 % |
| kcal casadas con el alimento **correcto** (producción) | "100 % de calidad" con casados erróneos | ≥ 98 % |
| día planificado frente al objetivo de cada adulto (tickets 07-10) | no existe objetivo | ±5 % en ≥ 90 % de los días |
| proteína del día frente al objetivo | — | ≥ 90 % |
| la receta visible, la barra de Hoy y la compra usan los mismos gramos | no (tres fuentes) | sí |

Los objetivos son más exigentes que en la versión del 2026-09-14 porque ahora hay fuentes
independientes. Si el eval del ticket 05 demuestra que no se alcanzan con coste razonable, se
apuntan aquí los números reales y se decide.

## Diagnóstico del estado actual

Comprobado leyendo el código y probando `matchFood` con un script (sin llamadas al modelo).

- **H1 — No hay objetivo energético.** `macroTargets` ([src/lib/macros.ts](../../src/lib/macros.ts))
  es una referencia genérica. El "objetivo" de la barra de Hoy es la **suma de lo planificado**.
  `generatePlanBody` no recibe ninguna cifra de kcal y pide "Sin gramajes rígidos en los platos"
  ([src/lib/plan.functions.ts](../../src/lib/plan.functions.ts)). El perfil ya tiene `sex`,
  `date_of_birth`, `height_cm`, `current_weight_kg`, `activity_level`, `target_weight_kg` y
  `pregnancy_status`.
- **H2 — La ración es igual para todo el mundo.** `decomposeDishes(…, { servings: 1 })` con
  `RATION_ANCHORS` fijas ([resolve-dish.server.ts](../../src/lib/nutrition/resolve-dish.server.ts)).
- **H3 — La tabla mezcla crudo y cocinado.** Pechuga de pollo 165 kcal / 31 g P es el valor
  **asado** (cruda ≈ 120 / 22,5). Salmón 208 es **crudo**. Bacalao 105 es **cocinado** (crudo ≈ 82).
  `matchFood("pechuga de pollo cruda")` devuelve la fila asada con confianza alta.
- **H4 — Hay alias que agrupan alimentos distintos.** Resultados reales de `matchFood`:
  `salmorejo` → gazpacho, 35 kcal (real ≈ 110-150) · `morcilla`, `salchicha` → chorizo, 350 ·
  `crema de calabacin` → calabacín, 17 · `tortilla de patatas` → patata, 87 (real ≈ 190) ·
  `arroz con leche` → arroz blanco · `bacon`, `pavo loncheado` → genérico, 130. El alias `"mató"`
  lleva tilde y no está normalizado.
- **H5 — El eval mide confianza, no exactitud.** 100 % de "calidad" con los errores de H3 y H4
  dentro; con rangos de 200-450 kcal no se detecta un error del 40 %.
- **H6 — El resultado no es determinista.** El memo vive solo en el proceso y cada día se vuelve a
  preguntar al modelo.
- **H7 — Hay un único respaldo genérico de 130 kcal**, sin medias por categoría ni unidades.
- **H8 — El umbral de uso es `quality >= 0.4`** y la calidad se pondera por gramos, no por kcal.
- **H9 — Tres fuentes de gramos que no se hablan:** la descomposición de Hoy, `dishRecipe` y el
  `weekQty` que inventa el plan.
- **H10 — Nadie puede elegir no ver cifras.** La barra de kcal y macros se pinta para todo el mundo
  (web `hoy.tsx`, `day-detail-sheet.tsx`; móvil `hoy.tsx`). El único control es una regla de texto en
  el prompt del coach atada a `ed_history`.
- **H11 — La compra se recorta en cantidad.** `scaleShoppingToBudget` baja `weekQty` en proporción
  cuando el recorte por IA no basta.
- **H12 — La tabla es pequeña:** 167 filas.

## Decisiones (cerradas el 2026-09-15)

- **D1 — Gramos por persona visibles en la receta: sí.** La tarjeta del plan sigue sin gramos.
- **D2 — Objetivo calculado en código y plan dimensionado a él: sí.** La barra de Hoy mide contra
  el objetivo.
- **D3 — Ver cifras es una preferencia explícita**, no algo que la app deduzca de otros datos. Se
  pregunta en el onboarding, toda la app la respeta y se cambia cuando se quiera en Ajustes, que lo
  dice claramente. Con "no": ni kcal, ni macros, ni objetivos, ni porcentajes en ninguna pantalla,
  ni en el texto del coach ni en las notificaciones. Los platos se siguen calculando y escalando
  igual, y las recetas mantienen sus cantidades (hacen falta para cocinar la ración correcta).
  `ed_history` deja de controlar las cifras. Ver ticket 01.
- **D4 — Hogar: la ración de las comidas compartidas es la misma para todos los adultos** y tiene
  que ser compatible con el objetivo de cada uno. Si una comida compartida saca a un adulto de su
  plan, se corrigen **sus comidas no compartidas** (desayuno, merienda y las que no comparte) para
  volver a su objetivo: primero ajustando raciones y, si no basta, cambiando el plato. Los niños
  siguen con su ración manual. Ver tickets 08, 10, 11 y 12.
- **D5 — Valores de la tabla: USDA FoodData Central + CIQUAL.** BEDCA solo como contraste.
- **D6 — Llamada adicional a una IA barata: sí.** Ver "Fuentes independientes" más abajo.

## Arquitectura objetivo

```
plato (texto libre del plan, de "comí distinto" o del chat)
  │  dishKey(): normalizar
  ▼
dish_recipes (caché GLOBAL) ── acierto ──► receta canónica (1 ración base, gramos crudos, fuentes)
  │ fallo                                                         │
  ▼                                                               │
3 lecturas en paralelo:                                           │
  · Gemini 2.5 Flash, lectura A (temp 0,2)                        │
  · Gemini 2.5 Flash, lectura B (temp 0,6)                        │
  · Perplexity Sonar con búsqueda web: recetas publicadas con pesos
  ▼                                                               │
casar cada lectura con foods (código; lo ambiguo → Flash-Lite elige de una lista cerrada)
  ▼                                                               │
comparar (código): presencia, densidad kcal, reparto de macros    │
  │ coinciden → mediana                                           │
  │ no coinciden → juez GPT-5 mini (elige DENTRO del rango de las lecturas)
  ▼                                                               │
validateRecipe (código) → 1 reintento con pista → guardar ───────►│
                                                                  ▼
             energyTargets(perfil) de cada adulto → objetivo por comida
                                                                  ▼
             al generar el plan, por día y comida:
               · comida compartida → sharedPortion(): UNA ración para todos los adultos
               · comidas propias   → alignSoloMeals(): cierran el día de cada adulto
             factores guardados en PlanDay.portions
                                                                  ▼
             macros = Σ gramos × foods / 100 (se recalculan al leer; nunca se guardan)
                                                                  ▼
       Hoy · receta visible · detalle de día · plan · reajuste · compra
       (todo respeta profiles.nutrition_numbers: mostrar | ocultar)
```

### Fuentes independientes (D6)

**Por qué no bastan tres lecturas del mismo modelo:** se equivocan igual. Si Gemini recuerda mal
cuánto chorizo llevan unas lentejas, lo repite en las tres. Cada lectura adicional tiene que traer
conocimiento distinto.

| Papel | Modelo (OpenRouter) | Precio (catálogo, 2026-09-15) | Por qué |
|---|---|---|---|
| Lecturas A y B | `google/gemini-2.5-flash` | 0,30 $ / 2,50 $ por millón (entrada/salida) | ya integrado; buen conocimiento de cocina |
| Receta publicada | `perplexity/sonar` | 1 $ / 1 $ por millón + 0,005 $ por petición | busca en la web recetas españolas **con pesos reales** y devuelve las URLs; es la fuente más independiente |
| Juez (solo si no coinciden) | `openai/gpt-5-mini` | 0,25 $ / 2 $ por millón | otra familia, razona y admite salida estructurada; alternativa más barata en el A/B: `deepseek/deepseek-v3.2` (0,27 $ / 0,40 $) |
| Desambiguación | `google/gemini-2.5-flash-lite` | 0,10 $ / 0,40 $ por millón | elegir de una lista cerrada; no hace falta más |

La combinación final **no se asume: la decide el eval** del ticket 05 (A/B: 3× Gemini, 2× Gemini +
Sonar, y con o sin juez). Se adopta la más barata que cumpla los objetivos de exactitud.

**Evaluadas y descartadas o aplazadas:**

- **Edamam Nutrition Analysis** (desde 29 $/mes, soporta español): obliga a poner su atribución
  junto a las cifras, limita guardar resultados y prohíbe peticiones automáticas para almacenar
  datos. Choca con la caché global. Descartada.
- **FatSecret Platform NLP:** la edición gratuita solo tiene datos de EE. UU. en inglés; España y
  el español exigen Premier, con precio bajo petición (permite caché y no exige atribución).
  **Aplazada:** pedir presupuesto. Si es razonable, sería una 4.ª fuente de contraste por plato
  nuevo.
- **Nutritionix:** capa gratuita de 50 peticiones/día y planes de pago desde ~299 $/mes. Descartada.

### Piezas

| Pieza | Dónde | Pura | Ticket |
|---|---|---|---|
| Preferencia "ver cifras" | `profiles.nutrition_numbers`, onboarding, Ajustes, `showsNutritionNumbers` | sí | 01 |
| Golden set + eval de exactitud (con A/B de fuentes) | `src/lib/plan-eval/` | — | 02 |
| Base de composición v2 | `foods.sources.csv` → `scripts/build-foods.ts` → `foods.data.ts` | sí | 03 |
| Casado v2 | `src/lib/nutrition/nutrition.ts` | sí | 04 |
| Descomposición con fuentes independientes + validación | `resolve-dish.server.ts`, `sources/*.server.ts`, `validate-recipe.ts`, `reconcile.ts` | mixto | 05 |
| Receta canónica global | tabla `dish_recipes` + `recipes.server.ts` | no | 06 |
| Objetivo energético | `src/lib/nutrition/energy.ts` | sí | 07 |
| Escalado: ración compartida + comidas propias | `src/lib/nutrition/portion.ts`, `household-portions.ts` | sí | 08 |
| Receta visible = canónica | `dishRecipe` | no | 09 |
| Plan que encaja con el objetivo de cada adulto | `generatePlanBody` + `plan-fit.ts` | mixto | 10 |
| Compra derivada de recetas | `src/lib/nutrition/shopping.ts` | sí | 11 |
| Reajuste en código (en comidas propias) | `src/lib/nutrition/reflow.ts` | sí | 12 |

## Invariantes

1. **El modelo nunca escribe una cifra que se enseñe o se sume** (kcal, macros, gramos finales,
   precio). Las lecturas proponen gramos de la receta base; el juez solo elige dentro del rango de
   las lecturas; el código valida, recorta y escala.
2. **Ninguna receta se guarda con una sola fuente** (salvo `reviewed = true`, revisada a mano).
3. **Gramos en crudo en toda la cadena**, salvo los alimentos con `state: "listo"`.
4. **Las macros se recalculan al leer** (`ingredientes × foods × factores`). Lo que se guarda son
   la receta y los factores de ración, nunca las cifras.
5. **`dish_recipes` es global y solo escribe el servidor** (`service_role`).
6. **Módulos puros sin `*.server`.** `foods` sigue fuera del bundle del navegador.
7. **`profiles.nutrition_numbers` manda en todas las superficies**: web, móvil, coach, push. Con
   `ocultar` no aparece ninguna cifra de kcal, macro u objetivo; los gramos de receta sí.
8. **Hogar: una sola ración compartida por comida para todos los adultos.** La desviación de cada
   adulto se corrige solo en sus comidas no compartidas. Nunca se expone el objetivo, el peso ni las
   cifras de un miembro a otro: solo se ven los gramos del plato compartido.
9. **Los factores de ración se fijan al generar el plan** y solo se recalculan por evento (cambio
   de la mesa, cambio del objetivo de un adulto > 5 %, reajuste). Hoy y los días pasados no se
   reescriben. Recolocar platos no cambia la compra. Paridad web/móvil vía `/api/v1`.
10. **No se usan modelos caros en producción.** Las llamadas adicionales son de modelos baratos y se
    pagan una vez por plato para toda la app (memoria `ai-plan-quality-cheap-model`).
11. **La compra nunca se recorta en cantidad** para cuadrar el presupuesto: se cambian platos o se
    avisa.

## Tickets y orden

```
01 preferencia "ver cifras" ────────────────────────────────────────────┐
02 golden set + eval ──► 03 foods v2 ──► 04 casado v2 ──► 05 fuentes + validación ──► 06 caché global
                                                                                          │
                              07 objetivo energético ──► 08 raciones (compartida + propias) ◄┘
                                                              │
                                     ┌────────────────────────┼──────────────────┐
                                     ▼                        ▼                  ▼
                             09 receta visible      10 plan al objetivo    12 reajuste en código
                                                              │
                                                     11 compra derivada
```

- **01-06 no cambian el producto** más allá de dar cifras correctas y estables, salvo la pregunta
  nueva del ticket 01.
- Después de **06** se vuelve a pasar el eval y se compara con la línea base de **02**.

## Coste

Estimación con los precios de la tabla y tamaños de prompt medidos a ojo (el ticket 05 los mide de
verdad):

| Llamada | Tokens aprox. | Coste aprox. |
|---|---|---|
| 2 lecturas Gemini 2.5 Flash | 900 de entrada + 500 de salida cada una | 0,003 $ |
| 1 lectura Sonar con búsqueda | 700 + 600 + petición | 0,007 $ |
| Juez GPT-5 mini (≈ 1 de cada 3 platos) | 2.500 + ~2.000 con razonamiento | 0,005 $ × ⅓ |
| Desambiguación Flash-Lite y reintentos ocasionales | pequeño | < 0,002 $ |
| **Total por plato nuevo** | | **≈ 0,01-0,015 $, una sola vez para toda la app** |

- 1.000 platos nuevos ≈ 10-15 $. Un plato ya visto por cualquier persona cuesta 0.
- El prompt queda más corto que ahora (sin la lista `FOOD_KEYS`) y la guía diaria deja de
  descomponer platos que ya están en caché.

## Riesgos

- **Alcance grande.** El orden permite parar tras cualquier ticket con valor entregado.
- **El golden set depende de revisión humana** (idealmente de alguien con formación en nutrición).
- **Sonar no tiene salida estructurada** en OpenRouter: hay que validar su JSON con Zod y tratar
  una respuesta inválida como lectura ausente.
- **Latencia con caché vacía** en Hoy: 3-4 llamadas en paralelo. Se mantiene `roughMealMacros`
  como respaldo mientras tanto y se precalientan los platos de la semana al generar el plan.
- **Hogar sin comidas propias:** si un adulto comparte todas sus comidas, no hay dónde corregir su
  desviación. Se avisa (si ve cifras) y el coach sugiere añadir una merienda (ticket 08).
- **Las cifras que la gente ya ve van a cambiar** al corregir H3 y H4. Es lo esperado.
- **Privacidad en el hogar:** calcular la ración compartida exige leer en servidor datos de otros
  miembros (peso, altura…). Solo `supabaseAdmin` con columnas limitadas; nunca viajan al cliente.

## Fuera de alcance

Micronutrientes, sodio y azúcares (campos reservados en `foods`), objetivos por edad para niños
(EFSA), códigos de barras y registro libre en gramos con báscula.

## Documentación que hay que actualizar al cerrar

CLAUDE.md y AGENTS.md (macros, receta canónica, fuentes, objetivo, ración compartida, preferencia de
cifras), `docs/agents/testing.md` y `.scratch/nutricion-determinista/spec.md` (ya apunta aquí).

## Comments

- 2026-09-15 — Decisiones D1-D6 cerradas por el usuario. Cambios respecto a la propuesta: D3 pasa
  de "ocultar según `ed_history`" a preferencia explícita en onboarding y Ajustes; D4 pasa de
  "ración de cada adulto según su objetivo" a "ración compartida igual para todos, corrección en las
  comidas propias"; se añade D6 (fuentes independientes baratas) tras comparar precios en el
  catálogo de OpenRouter y las condiciones de Edamam, FatSecret y Nutritionix.
