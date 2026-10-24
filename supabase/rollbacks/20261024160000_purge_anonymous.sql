-- Deshace supabase/migrations/20261024160000_purge_anonymous.sql (ticket 29,
-- punto 5). Lo ya borrado no vuelve: esto solo para la purga de las noches
-- siguientes.

BEGIN;

SELECT cron.unschedule('purge-anon-users');
DROP FUNCTION IF EXISTS public.purge_inactive_anonymous_users(integer);

COMMIT;
