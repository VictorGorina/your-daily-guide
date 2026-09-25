# Auditoría del cálculo de platos, raciones, kcal y macros — 2026-09-24

Pedida por el usuario: "no acabo de estar convencido que estemos calculando bien estos puntos".
Objetivo de la app, en sus palabras: una guía realista, que no necesita ser exacta pero que permita
cocinar los platos de cada día con lo comprado en el súper, con un plato alineado con cada tipo de
usuario y un cálculo de kcal y macros bastante preciso.

Resultado: el plan se rehízo el mismo día en [spec.md](spec.md) (fases, decisiones D7-D12 y tickets
13-20). Este documento es el diagnóstico en el que se apoya.

Seguimiento (mismo día): el usuario confirmó D7-D12 y añadió:

- **D13:** todo plato se calcula, sin promedios.
- **D10 revisada:** "comí distinto" es aproximado, pero proporcional a la necesidad calórica de cada
  persona.

Tickets 21-23 en el spec.

## Método

- **Código leído:** `resolve-dish.server.ts`, `nutrition.ts`, `foods.data.ts`, `guide.functions.ts`,
  `macros.ts`, `use-meal-swap.ts`, `day-settle.functions.ts`, `day-balance.ts`, `compensation.ts`,
  `exercise.ts`, `snacks.functions.ts`, `plan.functions.ts` (`generatePlanBody`, `enforceBudget`,
  `reflowMeals`, `resolveDish`, `dishRecipe`), `ai-provider.server.ts` (`coachSystemPrompt`),
  `onboarding.functions.ts`, `profile-fields.ts` y `onboarding.tsx`.
- **Plan existente:** el spec y los tickets 01-12, y la línea base provisional del eval
  (`src/lib/plan-eval/eval-report.md`: 75 recetas en borrador, `openai/gpt-5`, 3 pasadas).
- **Probado sin llamadas al modelo:** `matchFood` con 34 nombres de ingrediente, y la calidad de un
  plato con manteca.
- **No se hizo:** ninguna prueba en el navegador ni ninguna llamada al modelo.

## Veredicto

El sistema calcula razonablemente bien **cuánta energía tiene un plato por cada 100 g**: el error
medio de densidad es del 5,2 %, dentro del objetivo del 6 %. El fallo principal es anterior: **nadie
decide cuánto debe comer cada persona**. No hay objetivo energético, la ración la fija el modelo
igual para todo el mundo, y el "objetivo" que se enseña es la suma de lo que el plan propuso.

## Cómo funciona hoy

```
Onboarding (texto libre → la IA extrae los campos)
   ▼
Plan mensual (Gemini Pro): solo NOMBRES de plato; el prompt no lleva ninguna cifra
   y pide "Sin gramajes rígidos en los platos"
   ▼
Hoy: GPT-5 descompone cada plato → 1 ración de ancla (RATION_ANCHORS), igual para todos
   ▼
Tabla de composición → kcal/macros → su SUMA es "el objetivo" de la barra y del semáforo
   ▼
"Comí distinto" → misma descomposición → desvío frente al plato del plan → settleDay
   ▼
reflowMeals: la IA cambia NOMBRES de platos futuros; nadie comprueba las kcal

Aparte: receta = otra llamada con "cantidad orientativa"; compra = weekQty inventado por el plan
```

## Hallazgos estructurales

### A1 · No hay objetivo energético personal

- No hay TMB ni gasto diario (TDEE) en ninguna parte del código.
- [`macroTargets`](../../src/lib/macros.ts) es un respaldo genérico: 250 g de carbohidratos y 70 g de
  grasa fijos para todo el mundo, y proteína de 1,2 g/kg.
- El objetivo real es `guide.macroEstimate`, que es la suma de los platos planificados. Contra él se
  miden la barra y el semáforo del calendario (`daySignalOf`).
- Hoy enseña `Guía del coach · ${guide.calories}` (`src/routes/_authenticated/hoy.tsx:825` y
  `mobile/app/(app)/hoy.tsx:751`). Es un rango que el modelo de chat escribe sin ningún cálculo
  detrás. En la misma pantalla hay **dos objetivos distintos**.
- El prompt del plan recibe edad, peso, actividad y objetivo **como texto**, pero ninguna cifra.

Cuatro platos del golden set con lo que devuelve hoy el pipeline (desayuno 376 + comida 510 + cena
365 + merienda 210 = **1.461 kcal**), frente a lo que necesitarían tres perfiles (Mifflin-St Jeor):

| Perfil | Necesita | El plan le da | Semáforo si come el plan |
|---|---|---|---|
| Mujer, 32 años, 162 cm, 62 kg, sedentaria, quiere perder | ~1.310 | +11 % | verde |
| Hombre, 40 años, 180 cm, 85 kg, actividad ligera, mantener | ~2.450 | −40 % | verde |
| Hombre, 24 años, 185 cm, 78 kg, entrena 5 días, quiere ganar | ~3.440 | −58 % | verde |

Los tres ven verde porque se comparan consigo mismos.

### A2 · La ración la decide el modelo, igual para todos

- Las `RATION_ANCHORS` de `resolve-dish.server.ts` son las mismas para cualquier perfil. Explican la
  mayor parte del sesgo de +21,5 % frente a AESAN.
- Esos cuatro platos, a la ración de referencia de AESAN (punto medio), suman **959 kcal**. Eso está
  por debajo de lo seguro para casi cualquier adulto. La "ración correcta" solo tiene sentido frente
  al objetivo de cada persona.
- La ración base de AESAN sigue siendo la referencia, como decidió el usuario. Su papel cambia: es
  el punto de partida de las proporciones de la receta, no lo que se come.
- **Consecuencia:** si el código escala el plato al objetivo, la cifra que se enseña es la del
  objetivo por construcción. El error real de lo que se come pasa a ser **el de densidad** (~5 %)
  más el redondeo, no el ~23 % actual por ración.

### A3 · Tres fuentes de gramos que no se hablan

- Las kcal salen de la descomposición.
- La receta (`dishRecipe`) es otra llamada con "cantidad orientativa" en texto y **sin número de
  raciones**.
- La compra usa un `weekQty` que inventa el modelo del plan.
- `scaleShoppingToBudget` todavía recorta cantidades para cuadrar el presupuesto
  (`plan.functions.ts:420`).
- "Cocinar los platos con lo comprado" no está garantizado.

### A4 · La compensación no se verifica

- `reflowMeals` le dice al modelo "exceso de 400 kcal, recoloca". El código solo comprueba que haya
  cambiado **al menos un plato** (`day-settle.functions.ts:428`).
- El prompt pide "raciones algo menores", pero el plan no guarda raciones, así que esa palanca no
  existe.
- La tarjeta "Balance de hoy" enseña que el plan se movió, no cuánto.

## Errores concretos de cálculo

### B1 · Casados erróneos (prueba de `matchFood`, sin modelo)

| Nombre | Casa con | kcal/100 g | Real aprox. |
|---|---|---|---|
| tortilla francesa | `wrap` (tortilla de trigo), confianza baja | 310 | ~150-190 |
| granola · muesli · cereales de desayuno | genérico | 130 | 370-450 |
| bacon · panceta · sobrasada · chistorra | genérico | 130 | 300-600 |
| leche condensada | `leche-entera`, confianza baja | 62 | ~320 |
| harina de garbanzo | `garbanzos` cocidos, confianza baja | 164 | ~360 |
| pechuga de pavo loncheada | `jamon-cocido`, confianza alta | 110 | +25 % según las referencias externas |
| bebida de soja · leche de almendras | `bebida-avena`, confianza alta | 45 | distinta proteína y grasa |
| fabada · cocido · paella (como ingrediente) | genérico | 130 | — |

Bien casados: aceite de oliva, arroz integral, atún en aceite, alioli → mayonesa, queso rallado →
curado, mantequilla de cacahuete.

### B2 · La calidad se pondera por gramos, no por kcal

Patata 250 g + huevo 100 g + manteca de cerdo 30 g: **calidad 0,92** y 400 kcal. El plato ronda las
630 kcal: la manteca casa con el genérico de 130 kcal en vez de ~900. El 8 % de los gramos es el
40 % de la energía, y el umbral de uso es 0,4.

### B3 · Crudo y cocinado inconsistentes

`salmon` (208 kcal) es el valor USDA **crudo** del salmón de piscifactoría, pero lleva
`cookedYield: 0.80`. Si el modelo marca `wasRaw`, se le quita un 20 % de peso **y** se multiplica
por el valor crudo: cuenta un 20 % de menos. La mezcla de filas crudas y cocinadas sigue abierta
(`17a00d4` aplicó `cookedYield` sobre filas cocinadas, en contra del invariante 3 del spec).

### B4 · El aceite es la mayor causa del sesgo

Suelo de 25 g en fritos, cuando la tortilla medida con BEDCA retiene ~14 g. 20 g en la plancha, 10 g
en una tostada. Es el primer motivo en 8 de los 15 platos con más error. Le siguen los huevos (2
donde AESAN pone 1), la carne (muslo +117 % en gramos), el pan (60 g frente a 50), la fruta de
topping entera y la patata inventada en las cremas.

### B5 · El respaldo no lleva marca y entra en el cambio de plato

- Si la descomposición falla (**24 de 225 pasadas en el eval, ~11 %**, lotes enteros sin error
  registrado), esa comida cae a `roughMealMacros`: 600 kcal fijas para la comida y 500 para la cena.
- `MealMacroEstimate` no lleva ninguna marca de respaldo. `perMealKcalDeltas` calcula el desvío de
  "comí distinto" contra esa cifra inventada.
- Así, una pizza de +350 kcal reales puede quedar en +90 y no compensar nada, o al revés.

### B6 · La regla de proteína no se aplica

`compensationNeed` acepta `deltaProtein`, pero `settleDay` no se lo pasa
(`day-settle.functions.ts:295`). La regla aprobada (bajada de proteína de ≥ 20 g → compensar
siempre) existe en el código y en los tests, pero nunca se activa en producción.

### B7 · No es determinista

El memo solo vive en el proceso. Cada día se vuelve a preguntar al modelo por el mismo plato, con
una variación del 3,9 % entre pasadas.

### B8 · Deporte sin peso corporal y en bruto

`estimateExerciseKcal` usa kcal por minuto fijas: correr 30 min = 300 kcal para cualquiera. Lo real,
neto (sin contar el reposo, que ya está en el gasto diario), es ~220 kcal a 50 kg y ~440 a 100 kg.
Al contar el bruto, caminar se infla un ~30 %. En cuanto exista un objetivo con factor de actividad,
el entrenamiento habitual se contaría dos veces.

### B9 · `activity_level` tiene cuatro vocabularios

- Ajustes: `sedentario · ligero · moderado · alto`.
- Extracción del onboarding: `sedentario · ligero · activo · muy activo`.
- Valor por defecto: `activo ligero`. Perfil demo: `ligero · activo · muy activo`.
- La pregunta del onboarding mezcla el día a día con el deporte ("oficina pero gimnasio 3 días").
- El ticket 07 tal como estaba mapearía "muy activo" a 1,375: **−20 %** de gasto.

### B10 · "Comí distinto" no pregunta cantidad

Siempre asume 1 ración de ancla. No distingue unidades naturales (una pizza entera, un bocadillo) de
platos que se sirven en plato.

## Lo que está bien y hay que conservar

- La arquitectura "el modelo propone, el código calcula". La densidad ya cumple.
- `balance-del-dia`: el día es la unidad de decisión, con umbrales por objetivo y un solo
  asentamiento.
- Los platos fijados a mano (`pinned`), la compra canónica (la suma de las compras es igual a lo que
  necesita el mes) y los avisos de perecederos.
- El plan `precision-nutricional`: los tickets 07, 08, 10 y 12 son justo lo que falta.

## Propuesta

**Que el código decida la cantidad.** El modelo dice qué plato y en qué proporciones; el código dice
cuánto, a partir del objetivo de cada persona; y unos únicos gramos alimentan la receta, Hoy y la
compra.

```
perfil ─► objetivo (código) ─► presupuesto por comida (kcal + proteína)
                                    │
plan: la IA elige platos con esa pista ─► receta canónica (proporciones, caché global)
                                    │
             escalado en código al presupuesto, redondeado a medidas de cocina
                                    │
          LOS MISMOS GRAMOS ─► receta visible · barra de Hoy · lista de la compra
```

1. **Objetivo por persona desde el onboarding:** Mifflin-St Jeor × actividad del día a día + rutina
   de entrenamiento, separadas, sin preguntas nuevas. Una sola cifra en toda la app. Se recalcula
   por evento.
2. **Plato alineado con el tipo de usuario:** el plan recibe kcal y proteína por comida y una
   estructura por objetivo. Por ejemplo, para alguien que quiere ganar peso, primer y segundo plato,
   pan y postre, porque ningún escalado razonable convierte unas lentejas en una comida de
   1.200 kcal. `planFit` lo comprueba.
3. **Cálculo del plato:**
   - Receta canónica en caché global.
   - El aceite lo pone el código según el método de cocción.
   - Unidades: huevo de 50 g, rebanada de pan.
   - Tabla coherente y con las filas que faltan; calidad ponderada por kcal.
   - Escalado con límites y redondeo a medidas de cocina.
4. **Platos cambiados:**
   - El mismo camino y la misma caché para el plato planificado y el comido.
   - Cantidad por orden de prioridad: lo que diga el texto > la unidad natural > la misma masa que
     el plato planificado, más unos chips de tamaño.
   - Nunca calcular un desvío contra un respaldo. La proteína entra en la decisión.
   - Compensar en código sobre las raciones propias, y enseñarlo medido.
5. **Deporte:** (MET − 1) × kg × horas; la rutina habitual no se compensa dos veces.
6. **Compra y receta con los mismos gramos:** nunca recortar cantidad por presupuesto.
7. **Necesidades especiales** (propuesta nueva): enfermedad renal, diabetes, dieta vegana. Solo
   hacen las reglas más prudentes, con la recomendación de consultar a un profesional.
8. **Calibración con la tendencia de peso** (opcional): la fórmula tiene ±10 % de error entre
   personas; el peso real lo corrige.

**Orden:** primero las cifras honestas y el objetivo, sin IA nueva. Después una receta canónica y
unas cifras que no cambian. Después el escalado, el plan según el objetivo, el reajuste en código y
la compra derivada. Las fuentes independientes (Sonar y juez) y la calibración, solo si el eval o el
usuario lo piden. Detalle en [spec.md](spec.md).
