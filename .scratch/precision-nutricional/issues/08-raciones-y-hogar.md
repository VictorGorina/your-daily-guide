# 08 — Raciones: escalado al objetivo, ración compartida del hogar y comidas propias

Status: ready (D1, D2 y D4 aprobadas)
Blocked by: 06, 07, 21
Tamaño: L
Fase: 3

## Qué

Tres funciones puras que convierten la receta canónica en los gramos de cada plato:

1. `scaleRecipe`: escala una receta a un objetivo de kcal y proteína.
2. `sharedPortion`: elige **una sola ración** para una comida compartida, la misma para todos los
   adultos y compatible con el objetivo de cada uno (D4).
3. `alignSoloMeals`: ajusta las **comidas no compartidas** de cada adulto para que su día cierre en su
   objetivo después de la ración compartida.

Los factores resultantes se guardan por día en el plan y de ahí salen las macros de Hoy.

## Por qué

- Hallazgo H2: ahora la ración es igual para alguien de 1.600 kcal que para alguien de 2.900.
- Decisión D4: en casa todos los adultos comen la misma ración, y la desviación de cada uno se
  corrige en lo que come por su cuenta.

## Diseño

### 1. `scaleRecipe(recipe, target) → ScaledRecipe` — `src/lib/nutrition/portion.ts`

**Tres grupos por ingrediente**, decididos por los datos del alimento, no por etiquetas:

- **V (fijo):** verdura, fruta, hierbas, especias, caldo, sal y vinagre. No se tocan: bajar ración
  nunca quita verdura.
- **P (proteína):** alimentos donde la proteína aporta ≥ 35 % de sus kcal (`4·P / kcal ≥ 0,35`).
  Pollo, pescado, huevo (36 %), yogur griego (37 %), queso batido, tofu.
- **E (energía):** el resto. Cereal, legumbre (31 %), grasa, frutos secos, queso curado (27 %),
  lácteo normal.

**Dos factores con un sistema 2×2 en forma cerrada.** Con `kX`, `pX` = kcal y proteína del grupo X
en la ración base, y `K`, `Pt` = objetivo:

```
fP·kP + fE·kE = K  − kV
fP·pP + fE·pE = Pt − pV

det = kP·pE − kE·pP
fP  = ((K − kV)·pE − kE·(Pt − pV)) / det
fE  = (kP·(Pt − pV) − pP·(K − kV)) / det
```

- Grupo P vacío o `|det|` muy pequeño → un solo factor `f = (K − kV) / (kP + kE)`.
- **Punto de partida y límites:** los factores se aplican sobre la **ración personal** del ticket 21
  (receta base × factor `plan`), no sobre la base.
  - Límites para que el plato siga siendo reconocible: `fP ∈ [0,8; 1,5]`, `fE ∈ [0,7; 1,4]`,
    `fP / fE ∈ [0,6; 2,0]`.
  - Si uno se activa, se fija y el otro se resuelve **solo para kcal**.
  - Lo que no llegue lo arregla la estructura de la comida (23) o `planFit` (10), no un plato
    desfigurado.
- **Prioridad:** kcal primero; la proteína que falte queda como residuo.

**Redondeo a medidas de cocina:** aceite a 5 g ("1 cdta"; "1 cda" = 10 g) · carne y pescado a 10 g ·
pasta, arroz y legumbre seca a 5 g · verdura a 25 g · queso y frutos secos a 5 g · pan a 10 g ·
alimentos con `gPerUnit` (huevo, yogur, lata) en unidades enteras, mínimo 1. **Después de redondear
se recalculan las macros**: la cifra que se enseña es la de los gramos que se enseñan.

```ts
type PortionFactors = { fP: number; fE: number };
type ScaledRecipe = {
  ingredients: { foodKey: string; name: string; grams: number; cookedGrams?: number;
                 unitText?: string }[];
  macros: Macros;
  factors: PortionFactors;
  residual: { kcal: number; protein_g: number };
};
```

### 2. `sharedPortion(day, sharedSlot, recipe, adults) → PortionFactors` — `household-portions.ts`

`adults` = los adultos **con cuenta y objetivo** que comen en casa esa comida ese día (`homeSchedule`
+ `sharedSlots`). Los adultos sin cuenta no tienen objetivo: comen la misma ración, pero no cuentan
para elegirla. Los niños, fuera (ración manual).

1. **Punto de partida:** `scaleRecipe(recipe, media de los objetivos de esa comida)` (kcal y
   proteína medias de los adultos).
2. **Viabilidad por adulto:** con las raciones compartidas del día ya puestas, cada adulto tiene un
   presupuesto restante `R = objetivo del día − kcal compartidas del día`. Sus comidas propias pueden
   absorber un rango `[mín, máx]`, el que permiten los límites de `scaleRecipe` sobre sus recetas.
   El **exceso** de un adulto es cuánto cae `R` fuera de ese rango.
3. **Ajuste conjunto:** si algún adulto tiene exceso, se busca un multiplicador `m ∈ [0,80; 1,20]`
   (paso 0,01) sobre el objetivo de **todas** las comidas compartidas del día que minimice la suma de
   excesos. Empates: menor cambio total en las comidas propias; después, `m` más cercano a 1.
4. Resultado: **un** `PortionFactors` por comida compartida, igual para todos los adultos.

Es búsqueda en rejilla de ~40 valores por día: trivial de calcular, determinista y testeable.

### 3. `alignSoloMeals(adult, day, sharedKcal, soloRecipes) → { factors, misfit? }`

- Reparte `R` entre las comidas propias del adulto ese día, en proporción a sus pesos de reparto
  (ticket 07), y aplica `scaleRecipe` a cada una.
- `closeDay`: si algún límite se activa, el residuo pasa a las demás comidas propias del día con
  margen. Una sola pasada.
- Si aun así el día se aleja más del 5 % → `misfit { fecha, comida, kcalObjetivo, motivo }`. El
  ticket 10 lo corrige **cambiando el plato de esa comida propia** por uno que encaje ("corregir las
  comidas no compartidas").
- **Adulto sin comidas propias ese día** (lo comparte todo): no hay dónde corregir. Se guarda el
  residuo; si ve cifras y el desvío supera el 10 %, Hoy lo dice con tacto y el coach puede sugerir
  añadir una merienda en Ajustes.

### 4. Persona sola (sin hogar)

Todas sus comidas son propias: `alignSoloMeals` con `sharedKcal = 0`. Es el mismo camino, sin
casos especiales.

### 5. Dónde se guardan los factores

- `PlanDay.portions?: Partial<Record<MealSlotKey, PortionFactors & { shared?: boolean }>>`.
- **Comidas compartidas:** en la fila del planificador. Se espejan en la de cada miembro por el
  camino que ya existe: `syncSharedMeals` ([src/lib/household.server.ts](../../../src/lib/household.server.ts))
  escribe hacia adelante desde la fila del planificador.
- **Comidas propias:** en la fila de cada adulto. Las calcula el servidor con `supabaseAdmin` en la
  misma pasada de `syncSharedMeals`, porque dependen de las raciones compartidas.
- **Privacidad:** para calcular hay que leer en servidor peso, altura, edad, actividad y objetivo de
  cada adulto (columnas limitadas). **Nunca viajan al cliente de otro miembro:** cada uno solo ve sus
  gramos y las raciones compartidas.

### 6. Cuándo se recalculan (por evento, nunca por tiempo)

| Evento | Qué se recalcula | IA |
|---|---|---|
| Generar plan / `reflowMonthlyPlan` `scope: "full"` | compartidas + propias de todos los adultos, días futuros | no (solo el plan) |
| Objetivo de un adulto cambia > 5 % (peso, actividad, objetivo, embarazo) | lo mismo, días futuros | no |
| `setPlanMeal` en una comida compartida o propia | ese día | no |
| Reajuste por desvío (ticket 12) | comidas propias de ese adulto | no |

El segundo evento añade un `scope: "portions"` a `reflowMonthlyPlan`: solo código, sin cuota de IA.
Se dispara con el debounce silencioso de `plan-recalc.ts` (memoria `plan-auto-regeneration`: sin
banner de confirmación). Hoy y los días pasados nunca se tocan. **La compra no cambia** con estos
recálculos; si un ajuste pide algo no comprado, sale como aviso en `PlanDay.extras`, igual que ahora.

### 7. "Comí distinto" → ticket 17

La cantidad del plato cambiado ya no es "ración base × chip": pasa al ticket 17 (D10). Prioridad:
lo que diga el texto > la unidad natural > la misma masa que el plato planificado × chip.

## Consumo en este ticket

- `macrosFromLookup` (guía diaria): `getRecipes` → factores de `PlanDay.portions` de hoy →
  `mealMacros`. Si el día no tiene factores (plan antiguo) → se calculan al vuelo con
  `alignSoloMeals` y no se guardan.
- `use-meal-swap.ts`: `plannedKcal` sigue congelado en `plannedIdea`; el desvío por comida
  (`resolveDishDeltas` → `perMealDeltas`, ticket 13) se calcula con los mismos factores. La cantidad
  del plato cambiado la pone el 17.

## Archivos

- `src/lib/nutrition/portion.ts` + test
- `src/lib/nutrition/household-portions.ts` + test (`sharedPortion`, `alignSoloMeals`)
- `src/lib/plan-shared.ts` (`PlanDay.portions`, `mergeFuturePlan` conserva los factores de hoy y del
  pasado)
- `src/lib/household.server.ts` (`syncSharedMeals`)
- `src/lib/plan.functions.ts` (`reflowMonthlyPlan` `scope: "portions"`), `src/lib/plan-recalc.ts`
- `src/lib/guide.functions.ts`, `src/lib/macros.ts` (+ `mobile/lib/macros.ts`)

## Criterios de aceptación

- [ ] Tests de `scaleRecipe`: 2×2, grupo P vacío, cada límite, redondeo coherente
      (`macrosOf(redondeado) === macros`).
- [ ] Fixture "Pollo con arroz y verduras" (base ~650 kcal) a 520 y 850 kcal: kcal ±3 %, proteína
      ±10 %, verdura intacta.
- [ ] Test del hogar: adulto A de 1.730 kcal y adulto B de 2.450 kcal, comida y cena compartidas,
      desayuno y merienda propios → la ración compartida es la misma para los dos, y los dos cierran
      el día a ±5 % de su objetivo.
- [ ] Test del hogar sin margen: B lo comparte todo → residuo guardado y aviso, sin bucles.
- [ ] Test de privacidad: la respuesta que recibe A no contiene objetivo, peso ni kcal de B.
- [ ] Navegador (perfil demo): cambiar el peso cambia los gramos de los días futuros, no los de hoy.
- [ ] Simulador iOS: Hoy con las macros escaladas.

## Comments

- 2026-09-24 — Replanificación tras la auditoría: el §7 (chips × ración base) pasa al ticket 17 con
  otra regla (D10), porque la ración base infraestimaba a quien tiene un objetivo alto. Se corrige
  la referencia a `kcalDeltaOf`, que ya no existe (`resolveDishDeltas` / `perMealDeltas`).

- 2026-09-24 — Tras confirmar D7-D13: los factores parten de la ración personal del 21, con límites más estrechos; la estructura de la comida (23) cubre lo que el escalado no debe.
