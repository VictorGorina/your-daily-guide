-- Rollback de 20261004120000_due_push_profiles.sql (ticket 23). Sin la función,
-- `dispatchPush` vuelve solo al recorrido en JS (deja `push_due_rpc_failed`).

BEGIN;

DROP FUNCTION IF EXISTS public.due_push_profiles(int);
DROP FUNCTION IF EXISTS public.due_push_profiles_at(timestamptz, int);
DROP INDEX IF EXISTS public.profiles_onboarded_idx;

COMMIT;
