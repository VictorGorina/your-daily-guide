# Spec — Familia: identidad de miembros, comidas compartidas reales y compra por comensales

Status: propuesta, sin empezar (2026-09-01)
Autor: sesión Claude Code, 2026-09-01
Feature slug: `familia-comidas-compartidas`

## Resumen en una frase

Convertir la pestaña **Familia** de "cada uno marca por su cuenta qué comparte y se
reconcilia la intersección" a un modelo donde **quien crea la familia declara la mesa**
(con quién comparte comidas, incluidos adultos que no usan la app y los niños), **quien se
une elige quién es**, las **comidas compartidas son literalmente el mismo plato para
todos**, la **lista de la compra se dimensiona por raciones** de todos los comensales, y
cuando un plato compartido no sirve para un niño **el plan lleva su plato aparte**.

---

## 1. Estado actual (lo que hay hoy en `main`)

### Datos

- **`households`** — `id`, `name`, `invite_code`, `created_by`, `goal_type` / `goal_text` /
  `goal_budget_eur`. Migraciones `20260813154831`, `20260815120000`.
- **`household_members`** — PK `(household_id, user_id)`, `UNIQUE (user_id)` (⇒ un hogar por
  persona), `role` (`'adulto'`), `shared_meals jsonb`
  (`{desayuno:[], comida:[], cena:[0..6]}`, días 0=lunes…6=domingo). **No hay huecos sin
  reclamar**: al unirse se inserta directamente una fila con tu `user_id`.
- **`household_children`** — `id`, `household_id`, `name`, `age`, `allergies`, `appetite`,
  `notes`. Sin cuenta, solo contexto.
- **`profiles.family_context`** — texto libre del onboarding ("con quién vive, qué comidas
  comparte y con quién, niños con edades y alergias").
- **`monthly_plans`** — una fila por `(user_id, month)`: `plan jsonb`, `shopping jsonb`,
  `confirmed_at`, `trip_actuals`, `confirmed_trips`, `pantry_extras`, `trip_receipts`. RLS
  `"own monthly plans" FOR ALL` → estrictamente propia.

### Lógica

- **`src/lib/household.ts`** (+ copia `mobile/lib/household.ts`): CRUD del hogar, directo a
  Supabase con RLS. `joinHousehold` → RPC `join_household(_invite_code)` (con rate-limit,
  migración `20260822120000`): borra tu membresía previa e inserta una nueva.
- **`src/lib/household-shared.ts`** (+ copia parcial en `mobile/`): `SharedMeals`,
  `cleanSharedMeals`, `sharedDays(a,b,meal)` = **intersección** de dos configs,
  `hasAnyShared`, `describeShared`. `MEAL_KEYS = [desayuno, comida, cena]` (sin snack).
- **`src/lib/household.server.ts`**:
  - `householdContext(supabase, userId)` → texto para el prompt del coach: nº de adultos y
    niños, comidas compartidas descritas, alergias/apetito de los niños.
  - `syncSharedMeals({ userId, month, today, plan, shopping })` → para cada **otro** miembro:
    calcula la **intersección** de `shared_meals`, y para los **días futuros** (hoy y pasado
    fijados vía `planCursor`) **copia** `lunch`/`dinner`/`breakfast` del plan del que edita al
    plan del otro (con `supabaseAdmin`). La compra compartida se **une** de forma tosca
    (añade al otro los ingredientes que le falten por nombre, sin tocar cantidades). Un plan
    con `confirmed_at` no se toca.
- **`src/lib/plan.functions.ts`**:
  - `generateMonthlyPlan` — llama a `householdContext` y mete `home.text` en el system
    prompt; el prompt dice, en una frase, "si convive con más personas o hay niños, las
    comidas compartidas deben servir para todos y la compra debe cubrir esas raciones
    extra". `weekQty` (cantidad canónica por semana) lo estima la IA "a ojo".
  - `setPlanMeal`, `adjustMonthlyPlan` — llaman a `syncSharedMeals` tras guardar.
  - `toggleShoppingOwned`, `setTripActual`, `setTripConfirmed`, `scanTripReceipt`,
    `setPantryExtra` — todas escriben `.eq("user_id", context.userId)`: **estrictamente
    propias**.
- **`src/lib/ai-provider.server.ts`** `coachSystemPrompt(profile, householdText)` — imprime
  `householdText` como bloque "Hogar y comidas compartidas".
- **`src/routes/api/v1/household/sync.ts`** — única ruta HTTP del hogar (el resto del CRUD va
  directo a Supabase también en móvil).

### UI

- **`src/routes/_authenticated/hogar.tsx`** + **`mobile/app/(app)/hogar.tsx`** (copias):
  crear hogar / unirse con código; lista de miembros; rejilla 3 comidas × 7 días para marcar
  lo que compartes **tú**; objetivo del hogar; alta de niños; código de invitación; salir.
- **`src/components/bottom-nav.tsx`** (+ móvil): la pestaña se llama ya **"Familia"**
  (`/hogar`, icono `Users`), solo visible si `hasHousehold`.

### Invariantes que este cambio NO puede romper

(De `docs/agents/code-review.md` y las memorias `ux-roadmap`, `plan-shopping-quantities`.)

1. **Hoy y el pasado no se tocan nunca.** `setPlanMeal` = cambio literal de hoy en adelante;
   `adjustMonthlyPlan` = solo días futuros.
2. **La lista de la compra no cambia por un cambio de plan.** Si un plato pide algo no
   comprado → se guarda igual y falta en `PlanDay.extras` como aviso.
3. **El estado de una comida es por usuario, nunca se sincroniza al hogar** ("comí lo del
   plan" / "comí distinto" / "me lo salté" quedan privados).
4. **Cantidades canónicas:** `shopping` es una fila por ingrediente con `unit` + `weekQty[4]`
   - `weekPrice[4]`; `projectTrips` deriva la vista por compra; **Σ compras = total del
     mes**; cambiar de cadencia solo re-trocea. Nada de aritmética de cantidades en el prompt;
     no escalar precio sin escalar cantidad. Test de invariante en `plan-shared.test.ts`.
5. **Sin mecánicas de castigo** (semáforo sin rojo, saltarse una comida es neutro).
6. **Paridad web/móvil:** dos copias de cada pantalla y de `plan-shared` / `household-shared`
   (`lucide-react` vs `lucide-react-native`). Todo cambio en superficie compartida se aplica
   también en `mobile/` y se verifica en el simulador.
7. **Espejo `/api/v1/*`:** toda server function nueva tiene su ruta HTTP (3 líneas, misma
   lógica vía `apiPost`).
8. **Idioma:** identificadores/columnas en inglés, strings de usuario y comentarios en
   español.
9. **Migraciones** con prefijo timestamp, aplicadas a mano en el SQL Editor, RLS considerada.

---

## 2. Decisiones tomadas (con el usuario, 2026-09-01)

1. **Un planificador de la casa.** Una persona ("quien cocina/compra") es la dueña del plan
   y la lista de la compra del hogar; su `monthly_plans` es el del hogar para **todas las
   comidas compartidas**, dimensionado para todos los comensales. El resto de adultos solo
   planifican sus comidas **no compartidas**.
   - **Matiz del usuario:** cualquier miembro de la familia **dado de alta en la app** puede
     editar el estado de compra de esa lista — marcar "lo tengo en casa" / "comprado en el
     súper", el gasto real y la despensa extra. Esa parte es de todos, no solo del
     planificador. Lo que **no** puede tocar un no-planificador: los platos del plan, las
     cantidades y la cadencia.
2. **Adultos que no usan la app cuentan.** El creador los añade con nombre y ración; suman en
   la compra pero no tienen cuenta ni plan. El onboarding ya pregunta "¿tu pareja también va
   a usar Peppers?".
3. **Plato del niño: la IA lo genera y es editable por día.** Al crear el plan, si un plato
   compartido choca con un niño (alérgeno, edad, no lo come), la IA emite para ese niño ese
   día un plato alternativo y sus ingredientes entran en la compra a ración de niño.
   Editable día a día, como `setPlanMeal`.
4. **Un no planificador SÍ planifica sus comidas en solitario.** (D1) v1 mantiene una fila
   `monthly_plans` por adulto con cuenta: los slots compartidos vienen del espejo del
   planificador, y los NO compartidos los genera y edita cada uno para sí. `generateMonthlyPlan`
   tiene un modo "solo mis slots" para no planificadores.
5. **`shared_slots` lo edita solo el planificador.** (D2) El resto de adultos ven los días
   compartidos pero no los cambian, igual que con los platos.
6. **Traspaso de planificador automático al miembro con cuenta de más edad.** (D3) Si el
   planificador sale del hogar o borra su cuenta, `is_planner` salta al miembro con `user_id`
   y `date_of_birth`/`age` más antiguo (empate → `created_at` más antiguo). Sin miembros con
   cuenta, el hogar queda sin planificador (el último que sale se lleva su plan).
7. **Adulto sin app que se instala la app.** (D4) Su hueco pasa a `uses_app = true` y
   reclamable, conservando su `portion`. Lo activa el creador desde la mesa.
8. **Solo se comparten las 3 comidas principales.** (D5) `shared_slots` = `desayuno` /
   `comida` / `cena`. Los snacks son siempre personales; `MEAL_KEYS` no cambia.

---

## 3. Modelo objetivo

### 3.1 Roster de la familia e identidad

`household_members` pasa a representar **huecos de la mesa**, reclamados o no:

| columna              | cambio                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| `id uuid`            | **nuevo**, PK (`gen_random_uuid()`)                                    |
| `household_id uuid`  | igual, NOT NULL                                                        |
| `user_id uuid`       | **pasa a NULL-able**: `NULL` = hueco sin reclamar o adulto sin app     |
| `display_name text`  | **nuevo**, NOT NULL — lo pone el creador al declarar la mesa           |
| `uses_app boolean`   | **nuevo**, default `true` — `false` = adulto sin app, nunca reclamable |
| `is_planner boolean` | **nuevo**, default `false` — exactamente uno `true` por hogar          |
| `portion numeric`    | **nuevo**, default `1.0` — peso de ración para el cálculo de compra    |
| `role text`          | se conserva (`'adulto'`)                                               |
| `shared_meals jsonb` | **se elimina** (pasa a nivel de hogar, § 3.2)                          |

- PK nueva `id`; se elimina la PK `(household_id, user_id)` y el `UNIQUE (user_id)` se
  sustituye por índice **parcial** `UNIQUE (user_id) WHERE user_id IS NOT NULL` (un hogar por
  persona sigue en pie; varios `NULL` conviven).
- `UNIQUE (household_id, display_name)` para que la lista de "¿quién eres?" no tenga
  ambigüedades.
- **Backfill:** cada fila existente → `id` nuevo; `display_name` = `profiles.display_name`;
  `is_planner = (user_id = households.created_by)`; `portion = 1.0`; `uses_app = true`.

**`household_children`** gana `portion numeric` (default derivado de `age`: 1–3 → 0.3,
4–8 → 0.5, 9–13 → 0.75, 14+ → 1.0; `appetite` "poco/mucho" desplaza ±0.2). Editable.

**Flujo del creador (declarar la mesa).** Tras `createHousehold`, en la pestaña Familia:
añade un hueco por cada persona con la que comparte comidas → nombre, "¿usa la app?",
ración (o apetito). Los niños siguen por `household_children` (+ ración). El creador es
`is_planner` por defecto; puede reasignarlo a otro miembro con cuenta.

**Adulto sin app que se instala la app (D4).** El creador marca "ya usa la app" en su
hueco → `uses_app` pasa a `true`, el `portion` se conserva, y el hueco aparece en
`household_open_slots` para que la persona lo reclame con el código.

**Traspaso de planificador (D3).** No hay reasignación manual como único camino: cuando el
`is_planner` sale (`leaveHousehold`) o borra su cuenta (`account.functions.ts`), un trigger
/ helper mueve `is_planner` al miembro con `user_id IS NOT NULL` de **más edad** — se mira
`profiles.date_of_birth` (y `profiles.age` de respaldo); empate → `created_at` más antiguo
del miembro. Si no queda ningún miembro con cuenta, el hogar se queda sin planificador y su
plan deja de espejarse (caso degenerado: normalmente el último en salir es quien se lleva
el plan). El creador puede además reasignar a mano a cualquier miembro con cuenta.

**Flujo de quien se une (elegir quién eres).** `joinHousehold(code)` deja de insertar
directamente. RPCs nuevas (SECURITY DEFINER, sin filtrar hogares ajenos, rate-limit
reutilizado):

- `household_open_slots(_invite_code text)` → `[{ id, display_name }]` de los huecos adultos
  `uses_app` **sin reclamar** de ese hogar.
- `claim_household_slot(_invite_code text, _member_id uuid)` → valida que el código
  corresponde al hogar del hueco y que el hueco está libre y es `uses_app`; borra la
  membresía previa del usuario y hace `UPDATE household_members SET user_id = auth.uid()
WHERE id = _member_id`.

UI: meter código → "¿Quién eres?" con la lista de nombres → tocar el tuyo. Sin huecos
libres → "Pídele a quien creó la familia que te añada".

### 3.2 Una sola configuración de comidas compartidas (a nivel de hogar)

`households` gana **`shared_slots jsonb`**:

```jsonc
{ "desayuno": [1, 2, 3, 4, 5], "comida": [0, 1, 2, 3, 4, 5, 6], "cena": [0, 1, 2, 3, 4, 5, 6] }
```

Días 0=lunes…6=domingo. Significa "esta comida ese día es una comida compartida del hogar:
mismo plato para todos". Migrar desde el `shared_meals` del **miembro creador**; luego
eliminar `household_members.shared_meals`.

- `household-shared.ts` se reescribe: fuera `sharedDays` (intersección) y
  `cleanSharedMeals` por miembro; entra `cleanSharedSlots`, `isSharedSlot(slots, meal, day)`,
  `describeSharedSlots`.
- **v1: un slot compartido lo comen todos** los adultos + todos los niños (menos el niño que
  tenga plato aparte ese día, § 3.4). Un "eaters por slot" (excluir a un niño de un desayuno
  concreto) queda para una iteración posterior.
- **Editable solo por el planificador (D2).** El resto de adultos ven la rejilla de días
  compartidos en modo lectura, igual que con los platos.
- **Solo `desayuno` / `comida` / `cena` (D5).** Los snacks son siempre personales; no entran
  en `shared_slots` ni se espejan.

### 3.3 Compra dimensionada por comensales

`householdContext` se reescribe para producir, además del texto del coach, una **tabla de
raciones**:

- Para cada comida compartida (según `shared_slots`): `Σ portion` de todos los que la comen
  (adultos con `portion` + niños con `portion`).
- Para las comidas **no compartidas del planificador**: solo su `portion`.

`generateMonthlyPlan` (solo la corre el **planificador**, o un usuario en solitario) gana un
bloque de prompt:

> El hogar come estas raciones: desayuno compartido (días L–V) → 2,5 raciones; comida
> compartida (todos los días) → 3,2 raciones; cena compartida (todos los días) → 3,2
> raciones. Tus comidas en solitario → 1 ración. Dimensiona cada `weekQty` para esas
> raciones, ni de más ni de menos.

- La **invariante canónica no cambia** (Σ compras = total mes); solo cambia la magnitud
  objetivo. `weekPrice` acompaña.
- `plan-shared.test.ts` gana un caso: misma comida, 1 vs 3 raciones → `weekQty` ≈ ×3,
  Σ compras sigue cuadrando.
- El presupuesto prorrateado (`proratedBudget`) sigue saliendo de `profiles.budget_month_eur`
  del planificador — que, si la pareja no usa la app, el onboarding ya recoge como
  presupuesto **total de la casa**.

### 3.4 Plato del niño cuando el compartido no vale

`PlanDay` (en `plan-shared.ts`) gana:

```ts
kids?: { childId: string; slot: MealSlot; dish: string; off?: string[] }[];
```

- `cleanDay` / `cleanPlan` validan `kids` (longitud tope, `slot` conocido, `dish` no vacío,
  `childId` string; `off` como `extras`).
- `generateMonthlyPlan` prompt: "Si un plato compartido no sirve para un niño (alérgeno,
  edad, no lo come), añade para ESE niño ESE día un plato alternativo sencillo en
  `days[].kids` y refleja sus ingredientes en `weekQty` a ración de niño."
- Helper `childMealsForDate(plan, date, childId)` y render:
  - **Hoy**: bajo el plato compartido, "Para Leo: crema de calabaza".
  - **Plan** (calendario del mes) y **`day-detail-sheet.tsx`**: igual.
  - Web y móvil.
- Server fn nueva `setChildMeal({ date, slot, childId, dish, today })` — paralela a
  `setPlanMeal`: escritura literal, hoy y pasado bloqueados, `off` vía `offShoppingList` →
  `kids[].off`. Ruta `/api/v1/plan/child-meal.ts`.
- `mergeFuturePlan` y `syncSharedMeals` arrastran `kids` igual que `breakfast`/`snack`/
  `extras` (un plato de niño puesto a mano manda sobre una regeneración posterior).

### 3.5 El plan del hogar y el plan personal de cada miembro (D1)

Cada adulto con cuenta conserva su fila `monthly_plans`. Los slots **compartidos**
(`shared_slots` del hogar) de esa fila son un **espejo del planificador** — de solo lectura
para el dueño de la fila, salvo que sea el planificador. Los slots **no compartidos** los
genera y edita cada uno para sí.

- Resolver de servidor `resolveHouseholdPlan(supabase, userId, month)` →
  `{ plannerId, isPlanner, mineRow, plannerRow }`.
  - **Lectura del menú de un día:** para cada slot, si `isSharedSlot(household.shared_slots,
meal, weekday)` → usar `plannerRow.plan`; si no → usar `mineRow.plan`. Un helper
    `composeDayForUser(mineRow, plannerRow, sharedSlots, date)` hace la mezcla en un solo
    sitio y lo consumen Hoy, el calendario del mes, `coachPlanContext`, `welcomeBriefing` y
    el repaso nocturno.
  - **Lista de la compra:** las comidas compartidas se compran en la lista del **planificador**
    (dimensionada para todos); las no compartidas de cada uno, en **su** lista, a su ración.
    La pestaña Ingredientes de un no planificador muestra las dos, separadas ("La compra de
    la casa · la lleva {nombre}" y "Tu compra"). El planificador solo ve la suya.
- **Escrituras de plato:**
  - Slot **compartido** → solo el **planificador** puede cambiarlo (`setPlanMeal` /
    `adjustMonthlyPlan` sobre su fila + `syncSharedMeals`). Un no planificador que lo pida
    (chat o UI) recibe "eso lo lleva {nombre} de tu casa; puedo cambiar tus comidas en
    solitario". Coherente con D2 (los días compartidos también los fija solo el planificador).
  - Slot **no compartido** → `setPlanMeal` / `adjustMonthlyPlan` sobre la fila **propia** del
    que llama. "Hoy no se toca" se respeta en las dos rutas.
  - `generateMonthlyPlan`:
    - **Planificador / usuario en solitario:** como hoy, dimensionado para el hogar (§ 3.3),
      con platos de niño (§ 3.4).
    - **No planificador (modo "solo mis slots"):** el `.validator` detecta que el usuario es
      miembro no planificador; el prompt recibe `shared_slots` del hogar y la instrucción
      "NO planifiques ni incluyas en la compra las comidas de estos slots — ya las cubre el
      plan de la casa; deja `lunch`/`dinner`/`breakfast` vacíos ahí". El resultado se guarda
      en su fila; los slots compartidos se rellenan luego con el espejo. Su `shopping` cubre
      solo lo suyo, a 1 ración.
- RLS: policy SELECT nueva en `monthly_plans` → un miembro del hogar puede **leer** la fila
  del planificador (necesaria para el espejo, el menú compuesto y la lista de la casa).

### 3.6 Estado de compra compartido (editable por cualquier miembro con cuenta)

La lista vive en la fila del planificador. `toggleShoppingOwned`, `setTripActual`,
`setTripConfirmed`, `scanTripReceipt`, `setPantryExtra` cambian a:

1. Resolver la **fila objetivo** = fila del planificador si el que llama está en un hogar,
   si no la propia.
2. Si objetivo ≠ propia → verificar membresía del hogar (`householdContext`) y escribir con
   `supabaseAdmin` **solo** las columnas de estado (`shopping.owned` / `ownedTrips`,
   `trip_actuals`, `trip_receipts`, `confirmed_trips`, `pantry_extras`) — nunca `plan` ni
   `weekQty`. Mismo patrón que ya usa `syncSharedMeals`.

- `pantry_extras` ("lo que ya tenemos en casa") pasa a ser **del hogar** por la misma vía
  (el usuario lo pidió explícitamente: "si tienen o no los ingredientes … editable para
  ambos").
- Alternativa considerada y descartada por más código: RPCs SECURITY DEFINER
  `household_set_owned(...)` etc. (RLS no restringe por columna).

### 3.7 Coach, onboarding, notificaciones

- `householdContext` → texto de roster con raciones, slots compartidos, restricciones de
  cada niño y quién es el planificador.
- `adjustMonthlyPlan`: el **planificador** recoloca los futuros compartidos (+ re-espejo) y
  los suyos; un **no planificador** solo recoloca sus comidas en solitario y, si pide tocar
  una compartida, recibe "eso lo lleva {nombre}" (D2). El resumen ya menciona "he ajustado
  las comidas compartidas de tu hogar" cuando `synced > 0`.
- **Traspaso de planificador (D3):** `leaveHousehold` y el borrado de cuenta llaman a
  `reassign_planner(householdId)` cuando el que sale es el planificador.
- Onboarding: sin cambios en el número de preguntas (memoria `onboarding-direction`). Tras
  el onboarding, empujón suave "crea tu familia en la pestaña Familia" (ya existe algo
  parecido, `onboarding.tsx:780`). Opcional: pre-rellenar el roster desde `family_context`
  (fuera de v1).
- Push / repaso nocturno: sin cambios de disparo; revisar que el copy no dé por hecho "tu
  plan" cuando es el del hogar.

---

## 4. Migraciones

1. `NNNN_household_roster.sql` — rework de `household_members` (§ 3.1): `id` PK,
   `user_id` NULL-able, `display_name`, `uses_app`, `is_planner`, `portion`; índice parcial;
   backfill; `household_member_list()` devuelve las columnas nuevas; RPCs
   `household_open_slots` + `claim_household_slot`; se conserva la tabla de rate-limit.
   Función `reassign_planner(_household_id uuid)` (SECURITY DEFINER) que pone `is_planner` en
   el miembro con `user_id` de más edad (`profiles.date_of_birth` → `age` → `created_at`), y
   se llama desde `leaveHousehold` y desde el borrado de cuenta cuando el que sale es el
   planificador (D3).
2. `NNNN_household_shared_slots.sql` — `households.shared_slots jsonb`; migrar desde el
   `shared_meals` del creador; **luego** `ALTER TABLE household_members DROP COLUMN
shared_meals`.
3. `NNNN_household_children_portion.sql` — `household_children.portion numeric` + backfill
   por edad.
4. `NNNN_monthly_plans_household_read.sql` — policy SELECT: miembros del hogar leen la fila
   `monthly_plans` del planificador.

`PlanDay.kids` no necesita migración (vive en el blob `plan`).

---

## 5. Fases / issues

| #   | Título                                                   | Depende de |
| --- | -------------------------------------------------------- | ---------- |
| 01  | Roster e identidad — esquema + RPCs                      | —          |
| 02  | Roster e identidad — UI web + móvil                      | 01         |
| 03  | Una sola config de comidas compartidas + espejo completo | 01         |
| 04  | Raciones por comensal → cantidades de compra             | 01, 03     |
| 05  | Plan del hogar + plan personal por miembro (D1)          | 03         |
| 06  | Estado de compra y despensa compartidos                  | 05         |
| 07  | Plato del niño alternativo en el plan                    | 04, 05     |
| 08  | Coach, adjust, traspaso de planificador y copy           | 05, 07     |
| 09  | QA — demo en navegador + simulador + `/senda-review`     | 02–08      |

Cada issue: `bun run lint` + `bun run typecheck` + `bun run test` verdes, cambio replicado
en `mobile/` y verificado en el simulador, server functions nuevas con su `/api/v1/*`.

---

## 6. Decisiones cerradas (con el usuario, 2026-09-01)

- **D1 — Un no planificador SÍ planifica sus comidas en solitario.** Mantiene su fila
  `monthly_plans`; los slots compartidos son espejo (lectura), los no compartidos los edita
  él. `generateMonthlyPlan` gana modo "solo mis slots". Detalle en § 3.5.
- **D2 — `shared_slots` lo edita solo el planificador.** El resto lo ve en modo lectura.
- **D3 — Traspaso automático al miembro con cuenta de más edad.** Función `reassign_planner`
  al salir el planificador o borrar su cuenta (`profiles.date_of_birth` → `age` →
  `created_at`). Reasignación manual del creador sigue disponible.
- **D4 — Adulto sin app que se instala la app: sí.** El creador marca "ya usa la app" en su
  hueco → `uses_app = true`, `portion` conservado, hueco reclamable con el código.
- **D5 — Solo las 3 comidas principales.** `shared_slots` = desayuno / comida / cena. Snacks
  siempre personales.

---

## 7. Riesgos

- **05 toca todas las lecturas del plan.** Es el punto donde un error deja a un miembro sin
  ver su menú. Mitigación: `resolveHouseholdPlan` en un solo sitio, fases pequeñas,
  verificación con perfil demo (nunca la cuenta real del usuario — memoria
  `verify-with-demo-profile`) y capturas del simulador.
- **Datos antiguos.** Hogares ya creados con el modelo viejo: el backfill de la migración 1
  debe dejarlos funcionando (creador = planificador, miembros existentes = huecos
  reclamados). Listas de la compra antiguas (sin `weekQty`) siguen cayendo en el reparto de
  siempre.
- **Coste de IA.** Dimensionar por raciones y generar platos de niño no añade llamadas
  nuevas — va en el mismo JSON de `generateMonthlyPlan`. `setChildMeal` usa `offShoppingList`
  igual que `setPlanMeal` (una llamada corta).
