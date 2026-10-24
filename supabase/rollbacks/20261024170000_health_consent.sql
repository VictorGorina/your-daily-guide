-- Deshace supabase/migrations/20261024170000_health_consent.sql.
-- Antes, la guarda (rollbacks/20261024170100_health_consent_guard.sql) si está aplicada.
-- Borra la fecha y la versión de cada consentimiento dado: guárdalas antes si hacen falta.

BEGIN;
DROP TRIGGER IF EXISTS profiles_stamp_health_consent ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_stamp_health_consent();
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_health_consent_pair,
  DROP CONSTRAINT IF EXISTS profiles_health_consent_version_len,
  DROP COLUMN IF EXISTS health_consent_at,
  DROP COLUMN IF EXISTS health_consent_version;
COMMIT;
