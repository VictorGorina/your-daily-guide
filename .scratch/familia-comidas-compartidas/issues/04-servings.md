# 04 — Raciones por comensal → cantidades de compra

Status: hecho en código (rama `familia-comidas-compartidas`); migración
`20260901180000_household_children_portion.sql` **aplicada por el usuario (2026-09-01)**.
Falta re-verificar end-to-end con la columna ya presente (añadir peque, comprobar ración;
generar plan de hogar y comparar cantidades) y el pase en simulador.
Blocked by: 01, 03

## Implementado

- Migración `supabase/migrations/20260901180000_household_children_portion.sql`:
  `household_children.portion numeric` + backfill por edad (1–3→0.3, 4–8→0.5, 9–13→0.75,
  14+→1.0, sin edad→0.5).
- `household-shared.ts` (web + móvil): `Appetite`, `childBasePortion(age)`, `childPortion(age,
appetite)` (±0,2 sobre la base), `servingsPerSlot(members, children, sharedSlots)` →
  `{ shared, plannerSolo }`, `describeServings(servings, slots)`.
- `household.ts` (web + móvil): `HouseholdChild.portion`; `addChild`/`updateChild` la incluyen
  (móvil ganó `updateChild`, que antes solo existía en web). `types.ts` actualizado.
- `household.server.ts` `householdContext`: fetch de `household_children` incluye `portion`,
  calcula `servings` con `servingsPerSlot` y lo añade a `HouseholdContext` (además del `text`,
  que ahora imprime la tabla real en vez de la frase vaga "cubre las raciones extra").
- `plan.functions.ts` `generateMonthlyPlan`: nueva `servingsLine` con las raciones concretas
  por comida compartida + la ración en solitario del planificador, sustituye a la frase vaga.
- UI Familia (web + móvil): el input de texto libre "Apetito" del peque se sustituye por el
  mismo selector Poco/Normal/Mucho que los adultos (reutiliza `APPETITES` para las etiquetas,
  `childPortion` para el número); editable también en la fila de cada peque ya creado, no
  solo al añadirlo.
- Tests: `household-shared.test.ts` gana casos para `childBasePortion`/`childPortion`/
  `servingsPerSlot`/`describeServings`; `plan-shared.test.ts` gana el caso de invariante con
  `weekQty` ×3 (Σ compras = total del mes, estable al cambiar cadencia, igual que sin
  escalar). 105 tests verdes, lint/typecheck limpios en las dos plataformas.

## Verificación

- Perfil demo (Marta, hogar con Alex): la sección "Peques en casa" renderiza el selector
  Poco/Normal/Mucho en vez del input libre; sin errores de consola nuevos.
- Confirmado que `household_children.portion` **no existe todavía en la BD real**
  (`column household_children.portion does not exist`, 42703) — la query de niños fallando
  cae con gracia a lista vacía (`?? []`), no rompe la pantalla; mismo patrón que el 03 antes
  de aplicar su migración.

## Pendiente

- Aplicar `20260901180000_household_children_portion.sql`.
- Con la migración aplicada: añadir un peque, comprobar que su ración se guarda y se ve en la
  fila; generar un plan en un hogar de 2 adultos + 1 niño y comparar cantidades en Ingredientes
  contra un perfil en solitario con los mismos platos (deben ser sensiblemente mayores, total
  dentro de presupuesto). Simulador iOS.

---

## Objetivo (original)

La lista de la compra se dimensiona para todos los que comen cada plato (adultos + niños),
no "a ojo".

## Tareas

1. Migración `NNNN_household_children_portion.sql`:
   `ALTER TABLE household_children ADD COLUMN portion numeric NOT NULL DEFAULT 1.0`; backfill
   por edad (1–3 → 0.3, 4–8 → 0.5, 9–13 → 0.75, ≥14 → 1.0; `NULL` → 0.5).
2. UI Familia (web + móvil): campo ración/apetito por adulto y por niño → `portion`
   (adulto en `household_members`, niño en `household_children`). Apetito "poco/normal/mucho"
   → 0.8 / 1.0 / 1.2 para adultos; ±0.2 sobre la base de edad para niños.
3. `src/lib/household-shared.ts` (+ móvil): helper puro
   `servingsPerSlot(members, children, sharedSlots)` →
   `{ shared: Record<MealKey, number>, plannerSolo: number }`
   (`shared[meal]` = Σ portion de todos si el slot está compartido ese... — resumen por
   comida, no por día, basta para el prompt).
4. `src/lib/household.server.ts` `householdContext`: devolver también la tabla de raciones
   (`servings`) además del `text`.
5. `src/lib/plan.functions.ts` `generateMonthlyPlan`:
   - Bloque de prompt nuevo con las raciones concretas por comida compartida y "1 ración"
     para las comidas en solitario del planificador. Frase: "Dimensiona cada `weekQty` para
     esas raciones exactas."
   - Quitar la frase vaga actual ("la compra debe cubrir esas raciones extra") y sustituir
     por la tabla.
   - `enforceBudget` y `scaleShoppingToBudget` no cambian (siguen escalando cantidad y
     precio juntos).
6. `src/lib/plan-shared.test.ts`: caso de invariante con raciones — un `shopping` canónico
   dimensionado ×3 sigue cumpliendo Σ compras = total mes y estabilidad al cambiar cadencia.

## Verificación

Perfil demo con hogar de 2 adultos + 1 niño: generar plan, comprobar en la pestaña
Ingredientes que las cantidades son sensiblemente mayores que en un perfil en solitario con
los mismos platos, y que el total sigue dentro del presupuesto. Simulador: captura de la
lista.

## Hecho cuando

`weekQty` refleja las raciones del hogar; invariante canónica intacta con test nuevo verde;
lint/typecheck limpios; replicado en móvil.
