# 03 — Una sola config de comidas compartidas + espejo completo

Status: **hecho y verificado** en la rama `familia-comidas-compartidas` (migración aplicada
por el usuario en el SQL Editor). Falta el pase en simulador iOS (bloqueado por el mismo
bucle de alerta que el issue 02, ver `hoy-guide-retry-loop-bug.md`).
Blocked by: 01

## Implementado

- Migración `supabase/migrations/20260901170000_household_shared_slots.sql`:
  `households.shared_slots jsonb` (default desayuno vacío, comida y cena toda la semana),
  backfill desde el `shared_meals` del planificador (o del creador), `household_member_list()`
  redefinida sin `shared_meals`, y `DROP COLUMN household_members.shared_meals`.
- `household-shared.ts` (web + móvil): fuera `sharedDays` / `hasAnyShared` /
  `cleanSharedMeals` / `describeShared`; dentro `SharedSlots`, `cleanSharedSlots`,
  `isSharedSlot`, `describeSharedSlots`, `EMPTY_SLOTS`. `toggleDay` se queda.
- `saveSharedSlots` server function en `src/lib/household.functions.ts` (valida `is_planner`
  del que llama antes de escribir `households.shared_slots`) + ruta espejo
  `src/routes/api/v1/household/shared-slots.ts`. Móvil: `saveSharedSlots` en
  `mobile/lib/household.ts` vía `apiPost`. `saveSharedMeals` eliminada de las dos libs.
- `HouseholdState.household.shared_slots` expuesto (web + móvil), `HouseholdMember.shared_meals`
  eliminado. `types.ts` actualizado (households gana `shared_slots`, household_members y
  `household_member_list` pierden `shared_meals`).
- `src/lib/household.server.ts`: `householdContext` lee `households.shared_slots` y devuelve
  `{ householdId, plannerId, sharedSlots, members: HouseholdMemberLite[], text }`.
  `syncSharedMeals({ supabase, userId, month, today })` — fuente SIEMPRE la fila del
  planificador (leída con `supabaseAdmin`), destino todos los demás miembros con cuenta,
  solo días futuros, solo el plato (`lunch`/`dinner`/`breakfast` + `extras`); **ya no toca
  `shopping` del otro** (eso lo resuelve 05). Las 3 llamadas en `plan.functions.ts` y
  `syncHouseholdPlan` pasan la firma nueva.
- UI Familia (web + móvil): la rejilla escribe `shared_slots` del hogar, 3 comidas (sin
  snack). Solo el planificador la edita: el resto ve la rejilla `pointer-events-none` +
  nota "Lo decide {planificador}, que lleva la cocina en casa", y no ve "Guardar y ajustar
  planes". Copy nuevo.
- `hoy.tsx` (web + móvil): `sharedWith` usa `isSharedSlot(household.shared_slots, ...)`.
- Test `src/lib/household-shared.test.ts` (`cleanSharedSlots`, `isSharedSlot`, `toggleDay`,
  `describeSharedSlots`). `bun run lint`/`typecheck`/`test` + `tsc` móvil verdes.

## Verificación (con la migración ya aplicada)

- El hogar demo (`B27FAY3V`, Alex planificador / Marta) migró bien: `shared_slots` quedó con
  la config antigua de Alex (comida: [], cena: toda la semana), backfill correcto desde su
  `shared_meals`.
- Rejilla de Marta (no planificadora): los 7 botones de cena aparecen `on` y `disabled`,
  comida y desayuno `off` y `disabled` — coincide con la config real leída del hogar, no con
  un placeholder.
- `POST /api/v1/household/sync` (lo que dispara "Sincronizar el plan del mes") con la sesión
  de Marta → `{"synced":1}`: la fila del planificador se leyó y se mirroró a la fila de Marta.
- `POST /api/v1/household/shared-slots` con la sesión de Marta (no planificadora) → `500`, la
  escritura de `households.shared_slots` no se ejecuta (el candado `is_planner` del servidor
  la corta antes del `UPDATE`). El mensaje que ve el cliente es el genérico de `apiPost`
  ("No hemos podido completar la acción") en vez del texto específico — es el comportamiento
  ya establecido de todo `/api/v1/*` (colapsa cualquier error de servidor a un mensaje
  genérico salvo el prefijo "Unauthorized", ver `src/lib/api-route.server.ts`), no algo nuevo
  de este issue; en la web (que no pasa por `apiPost`) sí llega el mensaje específico. No
  afecta al uso normal: el botón de guardar ni siquiera se muestra a quien no planifica.

## Pendiente

- Pase en simulador iOS (roster + rejilla de comidas compartidas).

---

## Objetivo (original)

Las comidas compartidas dejan de ser "intersección de lo que marca cada uno" y pasan a ser
**una config del hogar**: el mismo plato para todos en esos slots.

## Tareas

1. Migración `NNNN_household_shared_slots.sql`:
   - `ALTER TABLE households ADD COLUMN shared_slots jsonb NOT NULL DEFAULT
'{"desayuno":[],"comida":[0,1,2,3,4,5,6],"cena":[0,1,2,3,4,5,6]}'::jsonb`.
   - Migrar: para cada hogar, `shared_slots` = `shared_meals` del miembro `is_planner` (o
     `created_by`).
   - `ALTER TABLE household_members DROP COLUMN shared_meals`.
2. `src/lib/household-shared.ts` + copia móvil:
   - Fuera: `sharedDays`, `hasAnyShared`, `cleanSharedMeals` per-miembro.
   - Dentro: `type SharedSlots = Record<MealKey, number[]>`, `cleanSharedSlots(raw)`,
     `isSharedSlot(slots, meal, day)`, `describeSharedSlots(slots)`, `toggleDay` (se queda).
3. `saveSharedMeals` (directo a Supabase) → **server function** `saveSharedSlots(slots)` en
   `src/lib/household.functions.ts` que valida `is_planner` del que llama antes de escribir
   `households.shared_slots` (RLS no restringe por columna y el editar el objetivo del hogar
   sigue siendo de cualquier miembro). Ruta espejo `src/routes/api/v1/household/shared-slots.ts`.
   `src/lib/household.ts` + móvil la llaman; `HouseholdState` expone `household.shared_slots`.
4. `src/lib/household.server.ts` `syncSharedMeals`:
   - Fuente = fila del **planificador**; destino = **todos los demás miembros con cuenta**.
   - Para cada slot marcado en `shared_slots`, copiar `lunch`/`dinner`/`breakfast` (+ `kids`
     cuando entre 07, + `extras`) a los **días futuros** del plan del otro (hoy y pasado
     fijados vía `planCursor`; mes íntegramente futuro → cursor "antes de todo", ya
     contemplado). Ya no se calcula intersección.
   - **Quitar la unión tosca de `shopping`**: la compra compartida es la del planificador y
     se lee vía el resolver de 05, no se copia. `syncSharedMeals` deja de tocar `shopping`
     del otro.
5. UI Familia (web + móvil): la rejilla "¿Qué comidas compartís?" pasa a escribir
   `shared_slots` del hogar (una sola, no "lo que marco yo"), con las **3 comidas
   principales** (D5, sin snack). Texto: "Estos días coméis lo mismo en casa. Lo planifica y
   lo compra quien lleva la cocina; tú marcas si ya lo tienes."
   - **Solo el planificador la edita (D2).** El resto de miembros ven la rejilla en modo
     lectura (misma pinta, `pointer-events-none` + nota "Lo decide {nombre del
     planificador}"). `saveSharedSlots` en servidor rechaza si el que llama no es
     `is_planner`.
6. Botón "Guardar y ajustar planes" → `saveSharedSlots` + `syncHouseholdPlan`.

## Tests

`household-shared.test.ts` (nuevo o en el de plan): `isSharedSlot`, `cleanSharedSlots`
(recorta días fuera de 0–6, dedup, ordena).

## Verificación

Perfil demo + segundo perfil demo en el mismo hogar: el planificador cambia la cena del
viernes → tras sincronizar, el otro miembro ve la misma cena el viernes (día futuro) y NO
cambia la de hoy. Simulador igual.

## Hecho cuando

Config única de slots persistida y migrada; espejo copia todos los slots compartidos del
planificador a los miembros, solo días futuros; `shopping` del otro ya no se toca aquí;
lint/typecheck/test verdes.
