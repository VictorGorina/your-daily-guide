# 12 — Reajuste por desvío calculado en código (en las comidas propias)

Status: ready
Blocked by: 07, 08, 10
Tamaño: M
Absorbe: la parte de `reflowMeals` de `.scratch/nutricion-determinista/issues/04-reflow-y-schema.md`

## Qué

Cuando alguien come de más o hace ejercicio, el desvío en kcal ya se conoce con exactitud (receta
canónica + tamaño de ración). Se compensa en código **ajustando las raciones de sus comidas propias**
de los días siguientes. Las raciones compartidas del hogar no se tocan: son de todos (D4).

## Por qué

Ahora el modelo recibe "exceso de 450 kcal" y decide a ojo; si no cambia nada, se le insiste
(`FORCE_ADJUST_KCAL`). Con kcal conocidas por comida, compensar es aritmética: justo lo que el modelo
hace mal y el código hace bien.

## Diseño

### `distributeDelta(deltaKcal, futureDays, soloSlots, targets) → PortionAdjust[]` (puro)

- Se reparte entre los **próximos 3 días editables** (nunca hoy ni días pasados).
- **Solo sobre comidas propias** de esa persona (desayuno, merienda y las que no comparte). Una
  persona sola: todas sus comidas.
- Límite por día: `|ajuste| ≤ 15 %` del objetivo diario y nunca por debajo del suelo del ticket 07.
- **Subir** raciones: como mucho +10 % por día (la compra no cambia; no puede faltar comida).
- Si 3 días no bastan → hasta 7. Lo que sobre **se descarta**, sin perseguirlo (tono del coach:
  "sin compensar en exceso").
- Dentro de cada comida, el ajuste recae en el grupo E (energía); proteína y verdura no se tocan.
- Si la persona lo comparte todo y no hay comidas propias → no se ajusta nada; con `mostrar`, el
  coach puede sugerir una merienda más ligera o más completa.

### Dónde se guarda

Se aplica sobre `PlanDay.portions` de la fila de esa persona (ticket 08) como multiplicador de `fE`
en sus comidas propias. La receta visible (ticket 09) enseña los gramos ya ajustados sin hacer nada
más. `mergeFuturePlan` y los recálculos `scope: "portions"` conservan el ajuste pendiente.

### Casos de seguridad

- Embarazo o lactancia: nunca ajuste negativo.
- Sin objetivo (`targets == null`): se mantiene el camino actual con IA.
- La preferencia `nutrition_numbers` **no** cambia el cálculo; con `ocultar`, los avisos y el coach
  hablan del ajuste sin cifras ("mañana y pasado, cenas un poco más ligeras").

### Qué queda para el modelo

`adjustMonthlyPlan` con una nota cualitativa ("quiero cenas más ligeras", "esta semana no tengo
tiempo") sigue usando el modelo con la forma `cambios`, pero:

- Se le pasan las kcal objetivo de cada comida que puede tocar.
- El resultado se comprueba con `planFit` (ticket 10) en vez del bucle de insistir.
- Fuera `FORCE_ADJUST_KCAL` y el "insiste una vez".

## Archivos

- `src/lib/nutrition/reflow.ts` + test (puro)
- `src/lib/plan.functions.ts` (`reflowMeals`, `adjustMonthlyPlan`)
- `src/lib/plan-shared.ts` (`PlanDay.portions`, `mergeFuturePlan`)
- `src/lib/use-meal-swap.ts` (sin cambio de forma; el lote sigue siendo una llamada)

## Criterios de aceptación

- [ ] Tests: reparto con y sin límites, suelo, subida ≤ 10 %, embarazo, persona que lo comparte todo.
- [ ] Test del hogar: el desvío de un adulto no cambia la ración compartida ni las comidas del otro.
- [ ] Navegador (perfil demo): en Hoy, "comí pizza y cerveza" → en los 3 días siguientes bajan las
      raciones de las comidas propias unas 450 kcal en total; la compra y hoy no cambian.
- [ ] Simulador iOS: `meal-swap-sheet` y el aviso de ajuste siguen funcionando.
- [ ] CLAUDE.md: actualizar la sección del plan (fuera `FORCE_ADJUST_KCAL`, dentro `PlanDay.portions`
      y la regla de comidas propias).

## Comments
