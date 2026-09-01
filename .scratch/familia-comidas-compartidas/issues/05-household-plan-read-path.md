# 05 — Plan del hogar + plan personal por miembro (D1)

Status: **hecho y verificado en web** (rama `familia-comidas-compartidas`). Lectura compuesta
(tareas 1–4), candados de escritura, modo "solo mis comidas" (tarea 6), pestaña Ingredientes
con doble bloque (tarea 5) y copy de no planificador (tarea 7) — todo en código, web + móvil.
Migración `20260901190000_monthly_plans_household_read.sql` aplicada. **Verificado en el
navegador con el perfil demo "Marta" (no planificadora del hogar `B27FAY3V`, planificador
Alex, solo la cena compartida).** Falta: pasada por el simulador iOS.
Blocked by: 03

## Bug encontrado y arreglado al verificar (2026-09-01)

La policy de SELECT permisiva que añadió la migración
(`USING (user_id = household_planner_of(auth.uid()))`) hace que **toda lectura de
`monthly_plans` con `.maybeSingle()` y sin `.eq("user_id", ...)` explícito devuelva 2 filas
(la propia + la del planificador) para un miembro no planificador**, lo que lanza `PGRST116`
y tumba `fetchMonthlyPlan` entero — Hoy y Plan en blanco para ese miembro. El código se
apoyaba en que la RLS antigua acotaba el SELECT a la fila propia.

Arreglo (mismo patrón que ya usaban todas las ESCRITURAS de estas funciones): filtrar la
lectura por `user_id`.

- `src/lib/daily.ts` + `mobile/lib/daily.ts`: `fetchOwnMonthlyPlan(month, userId)` ahora
  recibe el id y filtra las dos consultas (principal + reintento de compatibilidad).
- `src/lib/plan.functions.ts`: helper nuevo `ownPlanRow(supabase, userId, month, columns)`;
  lo usan `recadenceMonthlyPlan`, `toggleShoppingOwned`, `setTripActual`, `setPantryExtra`,
  `scanTripReceipt`, `setTripConfirmed`, `adjustMonthlyPlan`, `setPlanMeal`,
  `welcomeBriefing`, `dishRecipe`. `generateMonthlyPlan` no lee la fila (hace `upsert`), no
  cambia. Los reads server-side de `household.server.ts` ya usaban `supabaseAdmin` + filtro.
- Nota añadida a `docs/agents/code-review.md` para que futuras lecturas de `monthly_plans`
  no reincidan.

## Implementado

- Migración `supabase/migrations/20260901190000_monthly_plans_household_read.sql`:
  `household_planner_of(_user_id)` (escalar, para la RLS), `household_plan_context(_user_id)`
  (combo `planner_id` + `shared_slots` en una consulta, para el cliente), y policy SELECT
  nueva en `monthly_plans` (un miembro del hogar LEE la fila del planificador; el resto de
  operaciones siguen siendo estrictamente propias, se combinan con OR).
- `plan-shared.ts` (+ móvil): `composeDayForUser(mineDay, plannerDay, sharedSlots, weekday)`
  y `composeMonthlyPlanForMember(mine, planner, sharedSlots)` — lectura en vivo, para
  cualquier día; si `mine` es null, compone sobre un esqueleto en blanco con los rótulos
  del planificador (para no ver "sin plan" en lo que ya cubre la casa). Reutiliza
  `MEAL_SLOT_FIELD` / `isSharedSlot`.
- `daily.ts` (web + móvil): `fetchMonthlyPlan` factoriza `fetchOwnMonthlyPlan` y añade
  `householdPlanInfo` (RPC `household_plan_context`); si eres miembro no planificador,
  compone tu plan con la fila del planificador (una consulta más). **Esto cubre TODAS las
  lecturas de la tarea 4 de un golpe**: Hoy, la pestaña Plan (calendario + `day-detail-sheet`),
  `coachPlanContext` (chat + coach-fab) y el repaso nocturno consumen todos el mismo
  `fetchMonthlyPlan` vía react-query `["plan", month]` — cero cambios en esos archivos.
  `welcomeBriefing` (servidor) se deja como está: describe la fila recién generada por quien
  llama, que es lo correcto tanto para el planificador como para el modo solitario.
- Candados de escritura en `plan.functions.ts`:
  - `guardSharedSlotWrite` en `setPlanMeal`: si la comida de ese día es compartida y quien
    llama no es el planificador → error "Esa comida la lleva {nombre} de tu casa. Puedo
    cambiar tus comidas en solitario."
  - `adjustMonthlyPlan`: REGLA 5 en el prompt para un no planificador (no toques las
    compartidas) + cinturón mecánico `composeMonthlyPlanForMember(merged, current,
sharedSlots)` que restaura desde `current` cualquier slot compartido que la IA tocara.
    Summary aclara "Las comidas compartidas de tu hogar no las toco — esas las lleva {nombre}".
  - `generateMonthlyPlan` modo "solo mis comidas": si no eres el planificador, `servingsLine`
    pasa a "SOLO TUS COMIDAS EN SOLITARIO ... a {tu ración}", y `blankSharedSlots` vacía
    mecánicamente `lunch`/`dinner` de los días compartidos + la rotación de `breakfasts` si
    el desayuno se comparte. La `shopping` de esos slots depende de que la IA siga la
    instrucción (no hay filtro mecánico por ingrediente — misma tolerancia que el resto del
    prompt).
- Tests: `plan-shared.test.ts` gana 9 casos para `composeDayForUser` / `composeMonthlyPlanForMember`
  (slot no compartido = plan propio intacto, solo se pisa lo compartido, sin plan propio se
  ven las compartidas, rotación de desayuno, etc.). 114 tests verdes, lint/typecheck limpios
  en las dos plataformas.

## Desviaciones respecto al plan original

- **No se crea `src/lib/plan-resolve.server.ts` (tarea 2).** Su objetivo — resolver qué
  filas leer — lo cubren ya `householdContext` (da `plannerId`/`members`/`sharedSlots`) en
  el servidor y el RPC `household_plan_context` + `composeMonthlyPlanForMember` en el
  cliente. No hay ningún punto de lectura de servidor que necesite leer las dos filas a la
  vez (todas las lecturas visibles son de cliente vía `fetchMonthlyPlan`), así que un
  tercer "resolver" sin llamadas sería código muerto. Si 06/07 lo necesitan, se añade
  entonces.
- **Coste:** `fetchMonthlyPlan` llama al RPC en cada fetch (también para usuarios sin
  hogar, donde devuelve 0 filas). Es una consulta indexada mínima y react-query cachea por
  `["plan", month]`, así que solo se dispara en fetches reales, no en cada render.

## Tarea 5 — hecho (web + móvil)

`fetchPlannerShopping(month)` (nuevo en `daily.ts` × 2): la fila `monthly_plans` del
planificador para un miembro que no lo es (o `null`). Componente `HouseholdShoppingBlock`
(en `plan.tsx` × 2): tarjeta plegable "La compra de la casa · la lleva {nombre}", lista
agrupada por categoría en SOLO LECTURA (proyección `projectTrips(..., "mensual", ...)` — el
total del mes, sin navegador de compras). Debajo, "Tu compra en solitario" con el
`IngredientsTab` de siempre (la fila propia). Si el miembro aún no tiene fila propia
(`planQ.data.id === ""`), en vez del `IngredientsTab` vacío sale un empujón a "planificar
mis comidas en solitario". El planificador (`me.id === planner.id`) sigue viendo solo su
`IngredientsTab`; `plannerShoppingQ` va con `enabled: isSoloPlanner`. El estado de compra
del bloque de la casa es de solo lectura aquí — se hace editable en issue 06.

## Tarea 7 — hecho (web + móvil)

En `plan.tsx` × 2: `isSoloPlanner` = `!!me && !!planner && me.id !== planner.id`.

- Nota sutil bajo las subpestañas cuando `isSoloPlanner && hasSharedMeals`: "Las comidas
  compartidas de tu casa las lleva {nombre}. Aquí solo planificas y ves tus comidas en
  solitario." (Hoy ya trae la nota por comida "Base común con {nombre}" desde issue 03, no
  se añadió otra ahí.)
- Botón de la pantalla completa "crea tu plan" y `aria-label` del botón de regenerar →
  "Planificar mis comidas en solitario" para un no planificador; también el CTA del caso
  "sin fila propia" en Ingredientes.

## Pendiente

- Pasada por el simulador iOS (Hoy y Plan del no planificador, antes y después de planificar
  lo suyo).
- Re-verificar issue 04 (columna `household_children.portion` ya existe): añadir un peque,
  ver que su ración se guarda y sale; generar un plan de hogar y comparar cantidades.

---

## Objetivo (original)

Cada adulto con cuenta tiene su fila `monthly_plans`. Los slots **compartidos** son espejo
del planificador (lectura); los **no compartidos** los genera y edita cada uno. Es el issue
de mayor riesgo (toca todas las lecturas del plan) — fases pequeñas y verificación
exhaustiva.

## Tareas

1. Migración `NNNN_monthly_plans_household_read.sql`: helper SQL
   `household_planner_of(_user_id uuid) RETURNS uuid` (SECURITY DEFINER, sin recursión de
   RLS) → `user_id` del `is_planner` del hogar de `_user_id`, o `NULL`. Policy SELECT en
   `monthly_plans`: `user_id = household_planner_of(auth.uid())`.
2. `src/lib/plan-resolve.server.ts` (nuevo):
   `resolveHouseholdPlan(supabase, userId, month)` →
   `{ plannerId: string | null, isPlanner: boolean, mineRow, plannerRow }`
   (una sola consulta a `monthly_plans` con `user_id IN (userId, plannerId)`).
3. `src/lib/plan-shared.ts` (+ copia móvil): helper puro
   `composeDayForUser(mineDay, plannerDay, sharedSlots, weekday)` → para cada slot, coge del
   plato del planificador si `isSharedSlot(sharedSlots, meal, weekday)`, si no del propio.
   `mealsForDate` gana una variante o un parámetro que recibe los dos días + `sharedSlots`.
4. Puntos de lectura → pasan por resolver + `composeDayForUser`:
   - Guía diaria / Hoy: `src/lib/daily.ts` `fetchMonthlyPlan` (web) y su copia móvil; la
     server fn de guía si toca.
   - Pantalla Plan (web `plan.tsx` + móvil): calendario del mes (`PlanMonthCalendar` /
     `plan-month-calendar.tsx`, `day-detail-sheet.tsx`).
   - `coachPlanContext`, `welcomeBriefing`, repaso nocturno.
5. Pestaña Ingredientes de un no planificador: dos bloques —
   "La compra de la casa · la lleva {nombre}" (fila del planificador, solo lectura de
   platos/cantidades; el estado de compra se hace editable en 06) y "Tu compra" (su fila, sus
   comidas en solitario). El planificador solo ve la suya.
6. Escrituras de plato en `src/lib/plan.functions.ts`:
   - `setPlanMeal` / `adjustMonthlyPlan`: resolver el slot (fecha→weekday, `slot`). Si
     `isSharedSlot`:
     - el que llama **es** el planificador → escribe su fila + `syncSharedMeals`.
     - **no** es el planificador → error/aviso "Esa comida la lleva {nombre} de tu casa;
       puedo cambiar tus comidas en solitario" (coherente con D2).
       Si NO es shared → escribe la fila propia del que llama. "Hoy no se toca" en ambas.
   - `generateMonthlyPlan`:
     - planificador / solitario → como hoy + raciones de hogar (04) + platos de niño (07).
     - no planificador → el `.validator`/handler detecta que es miembro no `is_planner`;
       pasa `shared_slots` del hogar al prompt con "NO planifiques ni compres las comidas de
       estos slots — deja `lunch`/`dinner`/`breakfast` vacíos ahí; ya las cubre el plan de la
       casa". Guarda en su fila; su `shopping` cubre solo lo suyo a 1 ración.
7. UI: nota sutil en Hoy y Plan "Comidas compartidas · las lleva {nombre}". Botón "generar
   plan" del no planificador se etiqueta "planificar mis comidas en solitario".

## Verificación

Dos perfiles demo en el mismo hogar (comida y cena compartidas, desayuno no):

- Planificador genera → el no planificador ve comida y cena iguales en Hoy y Plan sin
  generar; su desayuno está vacío hasta que él planifica sus comidas en solitario.
- No planificador genera sus comidas en solitario → aparece su desayuno, la comida/cena
  siguen siendo las de la casa; su lista "Tu compra" solo tiene desayunos, a 1 ración.
- No planificador pide al coach "cámbiame la cena del jueves" → recibe el aviso de que la
  lleva el planificador. El planificador la cambia → cambia en los dos, hoy intacto.
- Simulador: capturas de Hoy y Plan del no planificador (antes y después de planificar lo
  suyo).

## Hecho cuando

Un no planificador nunca ve "no hay plan" para las comidas compartidas si el planificador ya
generó; puede planificar y editar sus comidas en solitario; los cambios de slot compartido
solo los hace el planificador y se propagan; lint/typecheck/test verdes; replicado en móvil.
