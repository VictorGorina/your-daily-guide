-- Deshace supabase/migrations/20261024120000_ai_spend_month_only.sql.
-- Aplicar a mano (`supabase db query --linked -f …`) y después
-- `supabase migration repair --status reverted 20261024120000`.
--
-- ANTES, revertir el código que manda `_month_only` (d8dcc8d): con la función
-- de dos argumentos, esa llamada fallaría y el gasto quedaría sin apuntar
-- (`spend_record_failed`). Al volver, el tope diario cuenta otra vez todo.

DROP FUNCTION IF EXISTS public.record_ai_spend(uuid, numeric, boolean);

CREATE FUNCTION public.record_ai_spend(_user_id uuid, _cost_usd numeric)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.ai_spend AS s (user_id, day, cost_usd, calls)
  VALUES (_user_id, (now() AT TIME ZONE 'utc')::date, GREATEST(coalesce(_cost_usd, 0), 0), 1)
  ON CONFLICT (user_id, day) DO UPDATE
    SET cost_usd = s.cost_usd + EXCLUDED.cost_usd,
        calls = s.calls + 1,
        updated_at = now();
$$;

REVOKE ALL ON FUNCTION public.record_ai_spend(uuid, numeric) FROM public;
REVOKE EXECUTE ON FUNCTION public.record_ai_spend(uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_ai_spend(uuid, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_spend(uuid, numeric) TO service_role;

ALTER TABLE public.ai_spend DROP CONSTRAINT IF EXISTS ai_spend_month_only_within_cost;
ALTER TABLE public.ai_spend DROP COLUMN IF EXISTS month_only_usd;

NOTIFY pgrst, 'reload schema';
