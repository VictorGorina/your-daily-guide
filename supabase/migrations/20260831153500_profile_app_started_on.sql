-- Fecha de alta de cada persona en la app. La usa la pantalla Plan como suelo
-- del navegador de meses (no se puede retroceder a antes de empezar a usar
-- Peppers) y para marcar los días previos como "antes de empezar", en vez de
-- "sin registrar". Se fija al completar el onboarding; los perfiles que ya
-- existen se rellenan con su fecha de alta de cuenta (created_at).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS app_started_on date;

UPDATE public.profiles
  SET app_started_on = created_at::date
  WHERE app_started_on IS NULL AND onboarding_completed;
