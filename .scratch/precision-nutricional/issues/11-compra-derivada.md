# 11 — Lista de la compra derivada de las recetas

Status: ready (D4 aprobada)
Blocked by: 06, 08, 10
Tamaño: L
Fase: 3
Absorbe: `.scratch/nutricion-determinista/issues/03-compra-derivada.md`

## Qué

`weekQty` y `weekPrice` dejan de salir del modelo. Se calculan sumando los gramos crudos de cada
comida y cada comensal con los factores de ración del plan (ticket 08). El presupuesto se cuadra
**cambiando platos**, nunca encogiendo cantidades.

## Por qué

- Hallazgo H9: ahora la compra la inventa el modelo aparte de los platos.
- Hallazgo H11: si se pasa del presupuesto, `scaleShoppingToBudget` compra menos comida de la que
  piden los platos cuyas macros enseñamos.
- Los gramos en crudo (ticket 05) son justo lo que se compra: la misma cifra sirve para macros y
  compra.

## Diseño

### `deriveShoppingList(plan, diners, portions, coverage) → ShoppingList` (puro)

Para cada día cubierto `d`, cada comida `s` y cada comensal que come en casa esa comida
(`homeSchedule`, `sharedSlots`; las comidas fuera de casa no cuentan):

- **Comida compartida (D4):** `ración compartida × nº de adultos en casa` (todos los adultos, con o
  sin cuenta, comen la misma) `+ Σ niños mesa × su portion` sobre esa misma ración. Niño
  `triturados`: su plato de `PlanDay.kids`. Niño `pecho`: nada.
- **Comida propia:** los gramos de ese adulto con sus factores (`alignSoloMeals`). Va a la lista de
  quien le corresponda según el modelo actual (planificador para lo suyo; cada no planificador para
  sus comidas en solitario).

Se suma por `foodKey` en la semana `floor((d − 1) / 7)` (la rejilla de siempre) y se genera un
`ShoppingItem` por alimento:

- `name` = `food.label`.
- `unit`: `ud` si tiene `gPerUnit` y se compra por piezas (huevo, yogur, lata); `ml` si es líquido;
  si no, `g`.
- `weekQty` = suma convertida a esa unidad; `weekPrice` = `priceOf`.
- `perishable` y `shelfLifeDays` salen de `foods`.
- Categoría de la compra: mapa `FoodCategory → "Verdura y fruta" | "Proteína" | "Despensa" |
  "Lácteos" | "Otros"`.
- **El aceite entra en la lista con su cantidad** (tiene kcal y coste reales). Sal, agua y especias
  siguen fuera.

`projectTrips`, `tripDayRange` y `freshRisksForTrip` no se tocan: ya trabajan sobre `weekQty`.

### Consecuencia de D4 en Familia

El selector de **apetito** de los adultos (`APPETITES` → `household_members.portion` en
`src/routes/_authenticated/hogar.tsx` y `mobile/app/(app)/hogar.tsx`) deja de tener efecto: en las
comidas compartidas todos los adultos comen la misma ración. **Se quita de la ficha del adulto**
(web y móvil). La columna se conserva (los niños la usan) y los valores de adultos se ignoran.
Cambiar el copy de Familia que hable de raciones por adulto.

### Prompt del plan

- Se quita `shopping` de la salida del modelo (y el bloque de instrucciones de `weekQty`/`weekPrice`).
- La "REGLA CLAVE" (platos cocinables con la compra) se cumple sola: la compra sale de los platos.

### Presupuesto (sustituye a `enforceBudget` + `scaleShoppingToBudget`)

1. **Sustituciones por tabla** `CHEAPER_SWAPS` (misma categoría y proteína parecida: salmón →
   caballa, ternera → pollo, piñones → pipas) en los ingredientes que **no dan nombre al plato**.
   Después, recalcular factores (ticket 08) para mantener las kcal.
2. Si no basta: **una** llamada con forma `cambios` para los platos que más cuestan del mes, con
   cuánto hay que ahorrar.
3. Si aún no basta: **no se escala nada**. Se guarda la lista completa y la pantalla avisa: "Este plan
   sale por 312 €, 22 € por encima de tu presupuesto". La persona decide.

### Invariantes que se mantienen

- Recolocar platos (`adjustMonthlyPlan`, `setPlanMeal`, recálculo por despensa) y los recálculos de
  factores (`scope: "portions"`) **no cambian** la compra. `PlanDay.extras` se calcula en código como
  diferencia de conjuntos.
- `reflowMonthlyPlan` con `scope: "full"` sí vuelve a derivar la compra (cambió la mesa).
- `carryOwnedCanonical` sigue traspasando las marcas por nombre.
- Las listas antiguas siguen siendo válidas.

## Archivos

- `src/lib/nutrition/shopping.ts` + test (puro)
- `src/lib/plan.functions.ts` (`generatePlanBody`, `enforceBudget`, `reflowMonthlyPlan`)
- `src/routes/_authenticated/hogar.tsx`, `mobile/app/(app)/hogar.tsx` (quitar apetito de adultos)
- Aviso de presupuesto en Plan > Ingredientes (web y móvil)

## Criterios de aceptación

- [ ] Test con un plan fijo: los gramos de pechuga de la lista = suma de los gramos de todas las
      comidas que la llevan.
- [ ] Test del hogar: 2 adultos (uno sin cuenta) + 1 niño `mesa` (portion 0,5) + 1 `pecho` →
      compartidas = 2 × ración + 0,5 × ración; comidas propias con sus factores.
- [ ] Los tests de `projectTrips` siguen en verde.
- [ ] Ningún camino de código reduce `weekQty` para cuadrar el presupuesto.
- [ ] Navegador (perfil demo): generar plan → la lista cuadra con las recetas visibles.
- [ ] Simulador iOS: Ingredientes, modo compra y Familia sin el selector de apetito en adultos.

## Comments
