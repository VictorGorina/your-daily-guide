-- Disyuntor global de gasto en IA (ticket 14 de la auditoría del 2026-09-26).
--
-- Los topes de `ai_spend` son por persona; con el alta anónima sin límite, mil
-- cuentas son mil topes. El servidor suma aquí lo que llevan gastado TODOS hoy
-- (día UTC, el mismo corte que `record_ai_spend` y `decideGlobalSpend`) y, si
-- pasa de `AI_GLOBAL_DAILY_USD`, pausa la IA para todos. PostgREST no suma
-- filas (los agregados están desactivados), de ahí la función.
--
-- SECURITY INVOKER, como `record_ai_spend`: se ejecuta con los permisos de
-- quien llama. `service_role` se salta RLS y la lee; si el EXECUTE volviera a
-- aparecer para `anon`/`authenticated` (lo haría un DROP + CREATE), la lectura
-- seguiría fallando por RLS y por los privilegios que se revocaron en
-- `20260915120000_ai_spend.sql`. El gasto de todos no debe verlo nadie más.

CREATE OR REPLACE FUNCTION public.ai_spend_total_today()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(sum(cost_usd), 0)
  FROM public.ai_spend
  WHERE day = (now() AT TIME ZONE 'utc')::date;
$$;

REVOKE ALL ON FUNCTION public.ai_spend_total_today() FROM public;
REVOKE EXECUTE ON FUNCTION public.ai_spend_total_today() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_spend_total_today() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ai_spend_total_today() TO service_role;
