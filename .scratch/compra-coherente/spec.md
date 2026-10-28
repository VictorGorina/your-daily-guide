# Compra y platos coherentes (2026-10-27)

Status: entregado (tanda 1 `ea484a5` + arreglos E2E `ff85d94`, `222a1ee`; tanda 2 `3e3721c`).
CI en verde y producción sirviendo `3e3721c`. Lo pendiente está en `issues/`.

## Qué pidió el usuario

1. En la cadencia optimizada salían perecederos en la primera compra que se comían semanas después.
2. En iOS no salían las macros.
3. El martes 27 de octubre el plan pedía crema de calabacín y no lo veía en la compra de esa
   semana: "asegura que las compras y los platos tengan sentido, no puedo cocinar un plato si no
   tengo los ingredientes".
4. En iOS no salía el candado a la derecha del último mes generado en Plan.

Se planificó con el método de la skill `grilling` (no está instalada en este repo; vive en
`/Users/v/Focus ST/.claude/skills/grilling`).

## Diagnóstico (con los datos reales, en solo lectura)

- **Optimizada:** `stockUpAmounts` adelantaba todo lo que "aguantaba" (manzana, naranja y huevos
  cada dos semanas) y `shelfLifeDays` se fiaba de la marca `perishable` de la IA antes que de su
  tabla: la zanahoria de noviembre, marcada no perecedera, iba entera el día 1.
- **Macros en iOS:** la cuenta del usuario tenía `nutrition_numbers = ocultar` (la única así). No
  era un fallo de iOS; además, la barra recortaba el exceso a 100 % y las kcal no tenían objetivo.
- **Calabacín del 27:** sí estaba en la compra de los días 25-31 (700 g), marcado "en casa". Pero
  el fallo de fondo era real: la IA escribe platos y lista a la vez y nada comprobaba que casaran
  (pera en 5 comidas y café en 12 sin estar en la lista; 16 platos de las semanas 2-3 con algún
  ingrediente a 0 g). Además, el reparto a partes iguales dejaba el 30 % del calabacín del 27 en la
  compra de los días 17-24, y las recolocaciones usaban la lista del mes entero, no la de su
  semana. `enforceBudget` podía quitar ingredientes sin tocar los platos.
- **Candado:** web e iOS hacían lo mismo; solo salía cuando el mes siguiente esperaba su semana de
  desbloqueo. Con noviembre desbloqueado, la flecha hacia diciembre salía apagada y sin candado.

## Decisiones del usuario

- Q1: la primera compra de la optimizada lleva la despensa del mes y patata, cebolla y ajo,
  junto con los frescos de su semana; las demás, solo lo fresco de sus días.
- Q2 (opción A): reparar la lista UNA vez al hacer el plan y, después, limitar los cambios
  automáticos a lo que hay en la compra de su día. Descartadas: "la compra sigue a los platos" y
  "solo avisar".
- Q3/Q7: quiere ver las cifras: cada plato calculado, recalculado al cambiar y comparado con el
  objetivo del día, por encima del 100 % si come de más. Línea de kcal con objetivo y %, exceso
  visible en la barra, colores con los cortes del semáforo; en Hoy no se avisa de quedarse corto.
  La opción de ocultar cifras se queda para quien la elija (sin recordatorios en Hoy).
- Q4: candado a la derecha del último mes que se puede abrir.
- Q5: dos tandas.
- Q8: un cambio automático solo entra si se cocina con lo de ese día y el día queda igual o más
  cerca de su objetivo; si no, se descarta.
- Q9: la lista entera aunque pase del presupuesto (Ingredientes ya avisa).
- Q10: sí a pasar la comprobación una vez por el plan de noviembre.

## Qué se hizo

**Tanda 1 (web e iOS)**
- `shopping/shelf-life.ts` (+ copia móvil): `shelfLifeDays` decide por forma de compra
  (congelado, conserva, UHT, seco…), luego fresco conocido por palabras enteras, luego la marca de
  la IA. `stocksUp` = lo que se compra de una vez. `stockUpAmounts(amounts, stocks)`.
- `plan/month.ts`: `nextMonthLocked`; las dos pantallas de Plan lo usan.
- `MacroBars` (web y móvil) + `intakeTone` en `macros.ts`: línea "~N de M kcal · %", muesca del
  100 %, exceso más claro, tono del semáforo en kcal/hidratos/grasa (no en proteína ni fibra).
- Textos en los cuatro catálogos (`macros.kcalOfTarget`, `leadToday`, `leadThatDay`, descripción
  de la optimizada). Tests nuevos y de paridad.

**Tanda 2 (casi toda de servidor)**
- `shopping/coverage.ts` (puro): `checkShopping` añade lo que falta, sube la semana corta (< 60 %)
  solo en compras sin empezar y sin marcas, y escribe `ShoppingItem.dayQty` (cada semana
  repartida entre los días que la usan; lo de compras hechas no se mueve).
- `shopping/coverage.server.ts`: recetas → `dishNeeds` (raciones de la casa, sin básicos ni
  comidas fuera), familias de sustitutos (`familyOfFood`), `editableDays`, `markMealsOut`
  (deduce comidas fuera de un plan viejo con UNA llamada), `availableByDay`, `purchasesText`.
- `plan/fit-run.server.ts`: el trabajo del ajuste hace también la comprobación (marca
  `MonthlyPlan.shoppingCheck`; también para planes con `fit`). Las pantallas Plan (web y móvil) la
  disparan si falta cualquiera de las dos marcas.
- `plan/verify-changes.server.ts` + `reflow.server.ts`: el prompt lleva la compra de cada tramo y
  cada cambio se verifica con su receta (compra del día + `dayScore`).
- `PlanDay.out` (comidas que no se cocinan en casa, `days[].fuera` en el prompt) y
  `MonthlyPlan.outMarked`.
- Fuera `enforceBudget`.
- `tripAmount` usa `dayQty` (web y móvil); `cleanShopping` lo descarta si no suma su `weekQty`.

Docs: CLAUDE.md y AGENTS.md (secciones de la cadencia optimizada, recolocación, cantidades y "La
compra se comprueba contra los platos"). Memoria: `shopping-dish-coherence`,
`macro-bars-over-target`, `plan-shopping-quantities`.

## Prueba en seco con los datos reales

Noviembre (todas las recetas en caché): añadiría lechuga y puerro y subiría las espinacas
congeladas (137,40 € → 139,14 €), cada cosa en la compra de sus días. Octubre (hoy 27): nada,
la última compra ya empezó; la pera queda "sin arreglo". `verifyPlanChanges`: una crema de
calabacín propuesta para el 10 de noviembre se descarta por "compra"; un plato del propio
noviembre movido de día se queda.

Cómo repetirla (solo lectura): leer la fila con
`bun run db monthly_plans --eq user_id=<id> --eq month=2026-11 --select plan,shopping,pantry_extras --limit 1`
y pasarla por un script que llame a `getRecipes(..., { userId: null, decompose: async () => new Map() })`
(caché sin IA), `dishNeeds` y `repairShopping` de `coverage.server.ts`, y compare `projectTrips`
antes y después.
