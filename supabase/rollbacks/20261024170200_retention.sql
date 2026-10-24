-- Deshace supabase/migrations/20261024170200_retention.sql. Quita los trabajos; no recupera lo ya borrado.
-- La extensión pg_cron se deja: quitarla borraría también cualquier otro trabajo.

SELECT cron.unschedule('retention-chat');
SELECT cron.unschedule('retention-rate-limits');
SELECT cron.unschedule('retention-join-attempts');
SELECT cron.unschedule('retention-ai-spend');
