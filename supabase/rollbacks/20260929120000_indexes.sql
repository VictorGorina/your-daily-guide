-- Deshace supabase/migrations/20260929120000_indexes.sql.
-- Aplicar a mano en el SQL Editor. Solo quita índices: ningún dato cambia.

BEGIN;

DROP INDEX IF EXISTS public.household_children_household_id_idx;
DROP INDEX IF EXISTS public.push_subscriptions_user_id_idx;
DROP INDEX IF EXISTS public.households_created_by_idx;
DROP INDEX IF EXISTS public.households_invite_code_upper_idx;

COMMIT;
