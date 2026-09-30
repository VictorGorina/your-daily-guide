-- Ticket 06 de la auditoría (SEC-S-04, SEC-DB-06): suscripciones push solo por
-- el servidor, con endpoint https, y una zona horaria inválida no se guarda.
-- Aplicar a mano en el SQL Editor. Rollback: supabase/rollbacks/20261001120000_push_hardening.sql.
--
-- Estado de producción el 2026-10-01: 0 suscripciones y solo zonas válidas
-- (Europe/Madrid, America/Los_Angeles), así que no hay nada que sanear antes.

BEGIN;

-- El cliente ya no inserta suscripciones: la web va por /api/push/subscribe,
-- que comprueba el host y escribe con la clave de servicio. Con el INSERT
-- directo se podía guardar cualquier URL y el cron le hacía fetch (SSRF).
REVOKE INSERT ON public.push_subscriptions FROM authenticated;
DROP POLICY IF EXISTS "insert own subscription" ON public.push_subscriptions;
REVOKE ALL ON public.push_subscriptions FROM anon;

ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_endpoint_https
  CHECK (length(endpoint) <= 512 AND endpoint ~ '^https://') NOT VALID;
ALTER TABLE public.push_subscriptions VALIDATE CONSTRAINT push_subscriptions_endpoint_https;

-- Zona horaria: una inválida se guarda como la de por defecto en vez de romper
-- el guardado del perfil, que Hoy hace en silencio al abrirse. No puede ser
-- NULL: la columna es NOT NULL. El cron, además, usa Madrid si le llega una
-- que Intl no conoce (`clockFor`).
CREATE OR REPLACE FUNCTION public.profiles_sanitize_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.timezone IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    NEW.timezone := 'Europe/Madrid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sanitize_timezone ON public.profiles;
CREATE TRIGGER profiles_sanitize_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_sanitize_timezone();

COMMIT;
