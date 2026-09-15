# 10 — Plan que encaja con el objetivo de cada adulto

Status: ready (D2 y D4 aprobadas)
Blocked by: 07, 08
Tamaño: L
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

- Planificador o persona sola: "Kcal orientativas por comida: desayuno ~430, comida ~600, cena ~485,
  merienda ~210. Elige platos que a una ración normal ronden esas cifras; las cantidades exactas las
  pone el sistema." En un hogar, para las comidas compartidas se da la media de los adultos (sin
  nombres ni cifras individuales).
- Se mantiene "sin gramajes en los platos": los gramos los pone el código.
- Las cifras del prompt no se enseñan a la persona; la preferencia `nutrition_numbers` no afecta a
  cómo se calcula el plan.
- **Salida por schema** (`generateObject` + Zod) en vez de `askForJson` con 3 reintentos. El JSON del
  plan es largo: medir latencia y tokens de salida antes de retirar el camino actual.

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

## Archivos

- `src/lib/plan.functions.ts` (`generatePlanBody`, `generateMonthlyPlan`)
- `src/lib/nutrition/plan-fit.ts` + test (puro)
- `src/lib/household.server.ts` (escritura de comidas propias corregidas)
- `src/lib/plan-eval/plan-fit-eval.ts` + `package.json` `"eval:plan"`

## Criterios de aceptación

- [ ] `bun run eval:plan` con 3 perfiles solos (~1.600, ~2.200 y ~2.900 kcal) y 2 hogares (dos
      adultos de 1.700 + 2.500 kcal; dos adultos + un niño `mesa`): ≥ 90 % de los días de cada
      adulto a ±5 % de su objetivo; proteína ≥ 90 %.
- [ ] En los hogares, la ración compartida es igual para todos los adultos en el 100 % de las
      comidas compartidas.
- [ ] Como mucho una ronda de corrección por generación (contada en el log).
- [ ] Test de `planFit`: prefiere corregir comidas propias antes que compartidas.
- [ ] Navegador (perfil demo): generar el plan del mes (gasta cuota de IA) y comprobar en el detalle
      de día que las kcal rondan el objetivo.
- [ ] Simulador iOS: el plan se ve igual.

## Comments
