-- Ticket 30 de la auditoría (RGPD art. 9.2.a): consentimiento explícito para
-- los datos de salud del perfil. Rollback: supabase/rollbacks/20261024170000_health_consent.sql.
-- Tests: supabase/tests/health_consent.test.sql.
--
-- Solo las columnas y la fecha. La guarda que impide guardar datos de salud sin
-- consentimiento va aparte, en supabase/pending/20261024170100_health_consent_guard.sql:
-- con ella aplicada, el onboarding de la web desplegada hoy (que aún no pide el
-- consentimiento) fallaría al guardar. Esta, en cambio, se aplica ANTES de
-- desplegar el código que la usa (ticket 24).

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS health_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS health_consent_version text;

-- Con fecha, siempre la versión del texto aceptado; sin fecha, ninguna.
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_health_consent_pair
  CHECK ((health_consent_at IS NULL) = (health_consent_version IS NULL));
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_health_consent_version_len
  CHECK (length(health_consent_version) <= 20);

-- La fecha del consentimiento la pone la base de datos, no el reloj del
-- dispositivo: es la prueba de cuándo se dio. Se fija al darlo (o al aceptar
-- una versión nueva del texto) y no se mueve con otras escrituras.
CREATE OR REPLACE FUNCTION public.profiles_stamp_health_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.health_consent_at IS NULL THEN
    NEW.health_consent_version := NULL;
  ELSIF TG_OP = 'INSERT'
     OR OLD.health_consent_at IS NULL
     OR NEW.health_consent_version IS DISTINCT FROM OLD.health_consent_version THEN
    NEW.health_consent_at := now();
  ELSE
    NEW.health_consent_at := OLD.health_consent_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_stamp_health_consent ON public.profiles;
CREATE TRIGGER profiles_stamp_health_consent
  BEFORE INSERT OR UPDATE OF health_consent_at, health_consent_version ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_stamp_health_consent();

COMMIT;
