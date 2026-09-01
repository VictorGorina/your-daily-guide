# 01 — Roster e identidad: esquema + RPCs

Status: hecho en código (rama `familia-comidas-compartidas`); **migración sin aplicar**
Blocked by: —

## Implementado

- `supabase/migrations/20260901160000_household_roster.sql` — columnas nuevas + backfill,
  PK `id`, `user_id` NULL-able, índice parcial, trigger `household_members_single_planner`
  (un único planificador), `household_assign_oldest_planner` + trigger
  `household_members_planner_handoff` (traspaso automático D3, cubre `leaveHousehold` y el
  borrado de cuenta sin tocar su código), `set_household_planner` (reasignación manual),
  `household_open_slots` / `claim_household_slot` (elegir quién eres, con el rate-limit de
  `join_attempts`), `household_member_list` con las columnas nuevas, RLS para que el creador
  gestione huecos. `join_household` sigue viva (rellena `display_name`); la neutraliza el
  issue 02 con la UI nueva.
- `src/integrations/supabase/types.ts` — `household_members` y `Functions` actualizados.
- `src/lib/household.ts` + `mobile/lib/household.ts` — `HouseholdMember` (`id`, `user_id`
  nullable, `uses_app`, `is_planner`, `portion`), `HouseholdState.planner`, `createHousehold`
  mete `display_name` + `is_planner`, y `openSlots` / `claimSlot` / `addAdultSlot` /
  `updateMember` / `removeMember` / `setPlanner`. `joinHousehold` marcada `@deprecated`.
- `bun run typecheck` / `lint` / `test` verdes; `tsc` de `mobile/` verde.

## Pendiente

- **Aplicar la migración a mano en el SQL Editor de Supabase** y verificar el backfill
  (creador = planificador, huecos reclamados, `household_open_slots` con un código real).
- `householdContext` (`household.server.ts`) todavía no lee las columnas nuevas — lo hace 04/08.

## Objetivo

## Objetivo

`household_members` pasa a representar huecos de la mesa (reclamados o no). Sin UI todavía.

## Tareas

1. Migración `NNNN_household_roster.sql`:
   - `ALTER TABLE household_members ADD COLUMN id uuid DEFAULT gen_random_uuid()`,
     `ADD COLUMN display_name text`, `ADD COLUMN uses_app boolean NOT NULL DEFAULT true`,
     `ADD COLUMN is_planner boolean NOT NULL DEFAULT false`,
     `ADD COLUMN portion numeric NOT NULL DEFAULT 1.0`.
   - Backfill: `id` a cada fila; `display_name` = `profiles.display_name` (join por `user_id`,
     fallback `'Adulto'`); `is_planner = (user_id = households.created_by)`. Tras el backfill,
     `SELECT reassign_planner(id) FROM households h WHERE NOT EXISTS (SELECT 1 FROM
household_members m WHERE m.household_id = h.id AND m.is_planner)` (hogares cuyo creador
     ya había salido).
   - `ALTER COLUMN user_id DROP NOT NULL`.
   - Quitar PK `(household_id, user_id)` y `UNIQUE (user_id)`; añadir `PRIMARY KEY (id)`,
     `CREATE UNIQUE INDEX ... ON household_members (user_id) WHERE user_id IS NOT NULL`,
     `UNIQUE (household_id, display_name)`.
   - Recrear `household_member_list()` para devolver
     `id, user_id, display_name, role, uses_app, is_planner, portion`.
   - RPCs nuevas (SECURITY DEFINER, `search_path = public`):
     - `household_open_slots(_invite_code text) RETURNS TABLE(id uuid, display_name text)` —
       huecos `uses_app AND user_id IS NULL` del hogar cuyo `invite_code` coincide.
     - `claim_household_slot(_invite_code text, _member_id uuid) RETURNS uuid` — valida
       sesión, que el hueco pertenece a ese `invite_code`, `uses_app`, `user_id IS NULL`;
       `DELETE FROM household_members WHERE user_id = auth.uid()`;
       `UPDATE household_members SET user_id = auth.uid() WHERE id = _member_id`; reutiliza
       la tabla/lógica de rate-limit de `join_household` (migración `20260822120000`).
     - `REVOKE ALL ... FROM public; GRANT EXECUTE ... TO authenticated` en ambas.
   - `join_household` antiguo: dejar de exponerlo (`REVOKE EXECUTE ... FROM authenticated`) o
     reescribirlo para que falle con "usa el flujo de elegir quién eres". No borrarlo aún
     (deep links / clientes viejos).
   - `reassign_planner(_household_id uuid) RETURNS void` (SECURITY DEFINER): si el hogar se
     queda sin `is_planner`, lo pone en el miembro con `user_id IS NOT NULL` de más edad —
     `LEFT JOIN profiles p ON p.id = user_id`, orden por `p.date_of_birth ASC NULLS LAST`,
     luego `p.age DESC NULLS LAST`, luego `household_members.created_at ASC`; `LIMIT 1`. Si no
     hay ninguno, no hace nada.
   - RLS: policy INSERT/UPDATE que permita al `created_by` del hogar crear huecos
     (`user_id IS NULL`) y editar `display_name`/`uses_app`/`portion`/`is_planner` de su
     hogar; el resto de miembros solo pueden editar su propia fila (igual que ahora).
2. `src/lib/household.ts` + `mobile/lib/household.ts` (copias):
   - `HouseholdMember` gana `id`, `display_name` (ya estaba), `uses_app`, `is_planner`,
     `portion`; quita `shared_meals` (se hace en 03, dejar el tipo por ahora si 03 no ha
     entrado — coordinar orden).
   - `createHousehold`: tras crear, insertar el hueco del creador con
     `is_planner = true`, `display_name` del perfil.
   - `addAdultSlot(householdId, { display_name, uses_app, portion })`,
     `updateMember(id, patch)` (incluye `uses_app: true` para D4 — "ya usa la app"),
     `removeMember(id)`, `setPlanner(householdId, memberId)`.
   - `openSlots(code)` → RPC `household_open_slots`; `claimSlot(code, memberId)` → RPC
     `claim_household_slot`. `joinHousehold` se marca deprecated.
   - `leaveHousehold`: tras borrar la membresía, si el que sale era `is_planner`, llamar a
     `reassign_planner(householdId)` (RPC). Igual en el borrado de cuenta
     (`src/lib/account.functions.ts` + su `/api/v1/account/delete`).
3. `src/lib/household.server.ts` `householdContext`: leer las columnas nuevas; el texto del
   coach todavía puede ignorarlas (se reescribe en 04/08). No romper la firma.

## Tests

`bun run typecheck` + `bun run lint` limpios. Verificación manual de la migración en el SQL
Editor de un proyecto de pruebas: backfill correcto, `household_open_slots` con un código
real devuelve los huecos, `claim_household_slot` reclama y respeta el rate-limit.

## Hecho cuando

Migración aplicada y revisada; hogares existentes siguen leyéndose (creador = planificador,
miembros = huecos reclamados); `household.ts` compila en web y móvil.
