# 10 — Plan que encaja con el objetivo de cada adulto

Status: ready (D2 y D4 aprobadas)
Blocked by: 08, 15, 23
Tamaño: L
Fase: 3
Absorbe: la parte de salida por schema de `.scratch/nutricion-determinista/issues/04-reflow-y-schema.md`

## Qué

El plan mensual se genera sabiendo cuántas kcal tiene cada comida, y se **comprueba en código** que
cada día, con las raciones del ticket 08, encaja con el objetivo de **cada adulto**. Lo que no encaja
se corrige cambiando platos en una sola ronda, empezando por las **comidas no compartidas** (D4).

## Por qué

El escalado tiene límites: una ensalada verde no puede ser una cena de 800 kcal sin dejar de ser una
ensalada verde. Y en un hogar, la ración compartida única puede dejar a un adulto fuera de su plan si
sus comidas propias no tienen margen. El plan tiene que proponer platos que **se puedan** ajustar.

## Diseño

### Prompt

Lo pone el ticket 23: kcal y proteína por comida, estructura de la comida (plato · acompañamiento ·
postre) y salida por schema. Este ticket comprueba en código lo que sale y lo corrige.

### Comprobación en código — `planFit(plan, household, targets, recipes)` (puro)

1. `getRecipes` de todos los platos únicos del mes (caché; los nuevos, en lotes).
2. Por día: `sharedPortion` en cada comida compartida → `alignSoloMeals` para cada adulto.
3. Una comida **no encaja** si:
   - es propia y `alignSoloMeals` devuelve `misfit` (el día del adulto queda a más del 5 %), o
   - la proteína del día de un adulto queda por debajo del 80 % de su objetivo, o
   - es compartida y ni con el multiplicador `m` hay forma de que las comidas propias de algún adulto
     absorban el resto.
4. Resultado: `{ fitPct, misfits: [{ fecha, comida, compartida, adulto?, motivo, kcalBase,
   kcalObjetivo }] }`. `adulto` es un id interno; nunca se manda al modelo.

### Corrección (una ronda)

- **Orden de preferencia (D4):**
  1. Comidas propias del adulto afectado.
  2. Solo si el problema es la comida compartida (plato imposible de ajustar para el conjunto), esa
     comida compartida.
- **Una** llamada con la forma de siempre (`{"cambios": [...]}`, `cleanReflowChanges` +
  `applyPlanChanges`), con cada comida a cambiar, su kcal objetivo y el motivo ("se queda corta: 310
  kcal para 600").
- Las comidas propias de un **no planificador** se escriben en su fila con `supabaseAdmin`, por el
  mismo camino que `syncSharedMeals`, y respetando `guardSharedSlotWrite`.
- Se vuelve a pasar `planFit` y se recalculan los factores. Lo que siga sin encajar se acepta con su
  residuo: nunca bucles.

### Estructura de la comida

La pide el 23. `planFit` comprueba además que la comida y la cena lleven ≥ 25-30 g de proteína
cuando el objetivo de proteína es ≥ 1,6 g/kg, y que ninguna comida principal sea de un solo
componente.

### Necesidades especiales (ticket 15)

El prompt recibe las reglas activas de la persona, sin nombrar la condición: "proteína moderada",
"carbohidratos repartidos y con fibra", "proteína vegetal en comida y cena". `planFit` las
comprueba igual que el objetivo.

## Archivos

- `src/lib/plan.functions.ts` (`generatePlanBody`, `generateMonthlyPlan`)
- `src/lib/nutrition/plan-fit.ts` + test (puro)
- `src/lib/household.server.ts` (escritura de comidas propias corregidas)
- `src/lib/plan-eval/plan-fit-eval.ts` + `package.json` `"eval:plan"`

## Criterios de aceptación

- [ ] `bun run eval:plan` con las tipologías del spec ("Qué significa personalizado"): mujer que
      pierde (~1.310), hombre que mantiene (~2.450), joven que gana entrenando (~3.440),
      embarazada, vegana, diabetes tipo 2, enfermedad renal, y 2 hogares (dos adultos de 1.700 +
      2.500 kcal; dos adultos + un niño `mesa`). ≥ 90 % de los días de cada adulto a ±5 % de su
      objetivo; proteína ≥ 90 % (salvo la marca `renal`, que no puede pasar de su tope).
- [ ] En los hogares, la ración compartida es igual para todos los adultos en el 100 % de las
      comidas compartidas.
- [ ] Como mucho una ronda de corrección por generación (contada en el log).
- [ ] Test de `planFit`: prefiere corregir comidas propias antes que compartidas.
- [ ] Navegador (perfil demo): generar el plan del mes (gasta cuota de IA) y comprobar en el detalle
      de día que las kcal rondan el objetivo.
- [ ] Simulador iOS: el plan se ve igual.

## Comments

- 2026-09-24 — Replanificación tras la auditoría: se añaden la estructura de comida por rango de
  kcal (el escalado solo no llega a los objetivos altos), la proteína por comida principal, las
  reglas del 15 y las tipologías de usuario como perfiles del eval.

- 2026-09-24 — Tras confirmar D7-D13: la parte de prompt (kcal por comida, estructura, schema) pasa al 23; aquí queda `planFit` y la corrección.

- 2026-09-26 — Implementado `planFit` y la ronda de corrección (sin commit todavía):
  - `src/lib/nutrition/plan-fit.ts` (puro, 10 tests): sirve cada día con `serveDay`; un día no
    encaja fuera de ±5 % o con proteína < **90 %** (no 80 %: con 80 la ronda nunca podía cumplir
    el criterio de aceptación). La culpable es la principal que menos se deja estirar (se le pide
    ±25 % y se mira cuánto sirve). Solo comida y cena; propias primero y compartida solo si no hay
    propias y quien genera planifica (D4). También marca principales de un componente y, con
    objetivo ≥ 1,6 g/kg, principales con < 25 g de proteína.
  - `src/lib/nutrition/plan-fit.server.ts` (`fitPlanMeals`): recetas → `planFit` → UNA petición
    (`askPlanFit`, formato `{"cambios"}`, solo ingredientes de la compra) → cada día se queda con
    la mejor variante (las dos, solo comida, solo cena) SOLO si baja `dayScore`; un plato nuevo
    sin receta no entra (D13).
  - Dónde: NO al generar (98-111 s de plan + ~2 min por cada ~20 platos nuevos no caben en 300 s).
    Va tras el precalentado (`recipe-warm.ts` resuelve `true` si no queda nada por calcular →
    `fitPlanOnce` → `fitMonthlyPlan`, `POST /api/v1/plan/fit`, bucket `plan-fit`). Marca
    `MonthlyPlan.fit` = una ronda por plan; solo planes con `targetsVersion`. Se relee la fila
    antes de escribir y solo entra un cambio cuya celda sigue igual. `PlanFitNote` (web + móvil)
    enseña los platos cambiados en "Cómo enfocamos el mes".
  - `sharedMealPortionsByDate` (household.server): las 7 variantes de la semana con una lectura.
  - `eval:plan-lite` con la ronda (`--no-fit` para quitarla), 7 días × 3 tipologías:
    kcal a ±5 %: 20/21 (el que falla tiene un plato "calculando", no se mide). Hombre y ganar:
    100 % sin cambiar nada (la ronda no toca lo que cuadra). **Mujer que pierde: 1/7 → 1/7**
    aunque aceptó 6 cambios que añaden proteína clara; la proteína sube pero queda en 73-91 g de
    99. Motivo: su objetivo está en el tope del 30 % de la energía (energy.ts) y desayuno
    (yogur con avena, tostada con aguacate) y merienda ("Zanahorias baby", 41 kcal de 160) no
    aportan proteína; la ronda no puede tocarlos (rotan por semana).
  - Tiempo de la ronda en el eval: 400 s en la mujer, pero casi todo es descomponer recetas que en
    producción ya hace el precalentado. Desglose por fase añadido (`report.seconds`); falta
    medirlo.
  - Falta: decidir cómo corregir desayuno/merienda; medir tiempos; navegador y simulador.

- 2026-09-26 (2) — Proteína de objetivos bajos, con las dos redes que eligió el usuario:
  - Prompt (`planTargetsPrompt`): con proteína ≥ 25 % de la energía (`proteinShare`,
    `HIGH_PROTEIN_SHARE`), desayuno y merienda también llevan fuente de proteína.
  - Ronda: `planFit` marca por proteína cualquier comida < 75 % de la suya (`MEAL_PROTEIN_MIN`),
    también desayuno y merienda; la ronda cambia su IDEA SEMANAL (`"ideas": [{semana, comida,
    opcion, plato}]`, `cleanWeeklyIdeas`) solo en semanas enteramente futuras (`isPlanWeekAhead`)
    y se queda con ella si baja la suma de `dayScore` de todos los días que la usan. Desayuno
    compartido: solo quien planifica. `applyPlanFitChanges` (plan-shared, testeado) aplica ambos
    tipos al guardar, solo si la celda sigue igual. Tope por ronda: 20 platos y 8 ideas, los días
    que peor encajan primero.
  - `eval:plan-lite --only mujer`: proteína ≥ 90 % 1/7 → **6/7**; `planFit` 0 % → 83 %; kcal a
    ±5 % 5/7 (uno es el cheat day permitido, "un plato libre que te apetezca"; el otro, −6 %, por
    una merienda nueva con menos kcal que la cena no pudo absorber); principales de un componente
    0/14. Tiempos de la ronda: recetas 143 s (en producción, el precalentado), modelo 38 s, nuevas
    57 s.
  - Falta: navegador (perfil demo, gasta cuota) y simulador; tipologías restantes del spec
    (embarazada, vegana, diabetes, renal, hogares) en el eval.
