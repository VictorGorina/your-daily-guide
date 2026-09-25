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
