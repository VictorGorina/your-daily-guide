-- Rollback de 20261003120000_push_cron.sql: para el disparo desde pg_cron.
-- Si el workflow de GitHub Actions ya no tiene `schedule`, hay que devolvérselo
-- (revertir ese commit) o no saldrá ningún aviso.
SELECT cron.unschedule('push-dispatch');

-- Opcional: borrar los secretos de Vault.
-- DELETE FROM vault.secrets WHERE name IN ('cron_secret', 'app_url');
