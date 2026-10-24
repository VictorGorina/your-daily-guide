-- Deshace supabase/migrations/20261024170100_health_consent_guard.sql.
-- Quita la guarda; no recupera los datos de salud borrados al retirar el consentimiento.

DROP TRIGGER IF EXISTS profiles_require_health_consent ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_require_health_consent();
