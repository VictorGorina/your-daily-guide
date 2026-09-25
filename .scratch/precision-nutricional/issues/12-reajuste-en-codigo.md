# 12 — Reajuste por desvío calculado en código (en las comidas propias)

Status: ready
Blocked by: 08, 13, 16
Tamaño: M
Fase: 3
Absorbe: la parte de `reflowMeals` de `.scratch/nutricion-determinista/issues/04-reflow-y-schema.md`
Retira: el ticket 18 (puente)

## Qué

Cuando `settleDay` decide compensar (el día entero, feature `balance-del-dia`), el desvío se reparte
**en código** sobre las raciones de las comidas propias de los días siguientes, en vez de pedirle a
la IA que cambie platos. Lo que enseña "Balance de hoy" es lo que el código movió, medido.

## Por qué

- H19: hoy basta con que cambie un plato. "Raciones algo menores" no existe en el plan; solo hay
  nombres de plato.
- Con kcal por comida conocidas (06, 08), compensar es aritmética: justo lo que el modelo hace mal y
  el código hace bien.

## Encaje con `balance-del-dia` (no se toca)

- La decisión sigue siendo `settleDay` → `dayBalance` → `compensationNeed`, **una vez** por día. Ahora
  lleva kcal **y proteína** (13), y el deporte neto y solo extra (16). El átomo es el día.
- Lo único que cambia es el paso 4 de `settleDay`: `distributeDelta` en vez de `reflowMeals`.
- Los tres libros de cuentas, la reserva, `dayReversing`, `mergeDayAdjustment` y el debounce de
  `day-settle.ts` se quedan igual.

## Diseño

### `distributeDelta(pending, proteinDelta, window, ownSlots, portions, targets) → PortionAdjust[]` (puro)

- **Ventana:** las fechas de `compensationWindow` (mañana → hoy + 6). Se reparte primero en los 3
  primeros días; si no basta, en el resto.
- `compensationWindow` pasa a considerar **todas las comidas propias** (desayuno y merienda incluidos),
  no solo comida y cena. Así el caso "shared-only" se da menos.
- **Límites:**
  - Por día, `|ajuste| ≤ 15 %` del objetivo, y nunca por debajo del suelo del 07.
  - Subir: como mucho +10 % por día, porque la compra no cambia y no puede faltar comida.
- Dentro de cada comida, el ajuste de kcal recae en el grupo **E** (energía). Proteína y verdura no
  se tocan.
- Una **bajada de proteína** (13) se repone subiendo el grupo **P** de las comidas propias siguientes,
  dentro de los límites del 08. Con la marca `renal` (15), no se repone.
- Lo que no quepa **se descarta** ("sin compensar en exceso") y se dice en la tarjeta.
- **Embarazo, lactancia o `diabetes_hipo`:** nunca un ajuste negativo. Ya lo decide
  `compensationNeed`; el 15 añade la marca.
- **Persona que lo comparte todo:** `shared-only`, como ahora.

### Dónde se guarda

- En `PlanDay.portions` de la fila de esa persona (ticket 08), como multiplicador de `fE` (o de `fP`
  para la proteína) en sus comidas propias.
- La receta visible (09) enseña los gramos ya ajustados sin hacer nada más.
- `mergeFuturePlan` y los recálculos `scope: "portions"` conservan el ajuste pendiente.
- La compra no cambia.

### Qué ve la persona (memoria `plan-changes-visible-to-user`)

- `MealChange` admite un cambio de **ración**: `{ date, slot, dish, kind: "racion", beforeKcal,
  afterKcal, beforeGrams?, afterGrams? }`, junto a los cambios de plato de siempre (`kind` ausente =
  plato).
- La tarjeta "Balance de hoy" lo enseña:
  - Con `mostrar`: "Cena del jueves: lentejas, ración −12 % (180 → 160 g)".
  - Con `ocultar`: "La cena del jueves, un poco más ligera".
  - Si se descartó algo: "He compensado 380 de 450 kcal; el resto no lo persigo".
- `dayMovedChanges` y el detalle de un día pasado entienden los dos tipos.

### Qué queda para el modelo

- `adjustMonthlyPlan`, con una nota cualitativa ("quiero cenas más ligeras", "esta semana no tengo
  tiempo"), sigue usando el modelo con la forma `cambios`, pero:
  - se le pasan las kcal objetivo de cada comida que puede tocar;
  - el resultado se comprueba con `planFit` (ticket 10) en vez del bucle de insistir.
- Fuera `FORCE_ADJUST_KCAL`, el "insiste una vez" y la medición puente del 18.
- **Sin objetivo** (`targets == null`: menor de edad o faltan datos): se queda el camino con IA más la
  medición del 18.

## Archivos

- `src/lib/nutrition/reflow.ts` + test (puro)
- `src/lib/day-settle.functions.ts` (paso 4)
- `src/lib/plan-shared.ts` (`compensationWindow`, `PlanDay.portions`, `MealChange`, `mergeFuturePlan`)
- `src/lib/day-balance.ts` (`dayMovedChanges`)
- `src/components/day-balance-card.tsx` y su equivalente en móvil; `day-detail-sheet.tsx`
- `src/lib/plan.functions.ts` (`adjustMonthlyPlan`)

## Criterios de aceptación

- [ ] Tests: reparto con y sin límites, suelo, subida ≤ 10 %, embarazo, persona que lo comparte
      todo, reposición de proteína, marca `renal`.
- [ ] Test: las kcal repartidas coinciden con lo pendiente (±5 %), o el residuo queda explicado.
- [ ] Test del hogar: el desvío de un adulto no cambia la ración compartida ni las comidas del otro.
- [ ] Navegador (perfil demo): en Hoy, "comí pizza y cerveza" → la tarjeta enseña raciones ajustadas
      en los días siguientes, con las kcal movidas. La compra y hoy no cambian.
- [ ] Simulador iOS: `meal-swap-sheet` y la tarjeta con cambios de ración.
- [ ] CLAUDE.md: actualizar la sección del plan y la de "Balance de hoy" (fuera `FORCE_ADJUST_KCAL`;
      dentro `PlanDay.portions`, la regla de comidas propias y los cambios de ración visibles).

## Comments

- 2026-09-24 — Reescrito tras la auditoría. La versión anterior era de antes de `balance-del-dia`:
  hablaba de `reflowMeals`, de "próximos 3 días" y de `FORCE_ADJUST_KCAL` sin el asentamiento único
  de `settleDay`. Ahora se engancha en el paso 4 de `settleDay`, usa `compensationWindow`
  (ampliada a las comidas propias), lleva proteína (13) y deporte neto (16), y hace visibles los
  cambios de ración en la tarjeta.
