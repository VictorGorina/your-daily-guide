-- Deshace supabase/migrations/20261001120000_push_hardening.sql.
-- Aplicar a mano en el SQL Editor. Ningún dato cambia: vuelve el INSERT directo
-- de suscripciones y se quitan la restricción y el disparador.

BEGIN;

DROP TRIGGER IF EXISTS profiles_sanitize_timezone ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_sanitize_timezone();

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_https;

GRANT INSERT ON public.push_subscriptions TO authenticated;
DROP POLICY IF EXISTS "insert own subscription" ON public.push_subscriptions;
CREATE POLICY "insert own subscription" ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

COMMIT;
