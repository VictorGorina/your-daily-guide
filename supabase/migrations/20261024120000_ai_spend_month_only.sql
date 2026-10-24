-- Gasto que solo mide el tope MENSUAL (auditoría del 2026-09-26, decisión de
-- la persona del 2026-10-23 sobre el tope diario).
--
-- `capScope: "month"` (src/lib/ai-spend.ts) dejaba pasar el tope diario a las
-- llamadas que no deben cortarse a medias, pero su coste seguía sumando al
-- día: generar el plan del mes (1,34 USD el 2026-10-11, contra un tope diario
-- de 0,75) dejaba a la persona sin coach ni ronda de ajuste hasta el día
-- siguiente. Ahora esas llamadas apuntan su coste también en
-- `month_only_usd`, y el tope diario mide `cost_usd - month_only_usd`. El tope
-- mensual y el disyuntor global (`ai_spend_total_today`) siguen sumando
-- `cost_usd` entero: el techo de cada persona y el de todos no cambian.

ALTER TABLE public.ai_spend
  ADD COLUMN IF NOT EXISTS month_only_usd numeric NOT NULL DEFAULT 0;

-- Parte de `cost_usd`, nunca más: así el día no puede salir negativo.
ALTER TABLE public.ai_spend
  ADD CONSTRAINT ai_spend_month_only_within_cost
  CHECK (month_only_usd >= 0 AND month_only_usd <= cost_usd);

-- Un parámetro nuevo no cabe en un CREATE OR REPLACE: crearía otra versión de
-- la función y una llamada con dos argumentos sería ambigua. Con DROP + CREATE
-- y `_month_only` opcional, el código ya desplegado (que manda dos) sigue
-- funcionando mientras llega el nuevo.
DROP FUNCTION IF EXISTS public.record_ai_spend(uuid, numeric);

CREATE FUNCTION public.record_ai_spend(
  _user_id uuid,
  _cost_usd numeric,
  _month_only boolean DEFAULT false
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.ai_spend AS s (user_id, day, cost_usd, month_only_usd, calls)
  VALUES (
    _user_id,
    (now() AT TIME ZONE 'utc')::date,
    GREATEST(coalesce(_cost_usd, 0), 0),
    CASE WHEN _month_only THEN GREATEST(coalesce(_cost_usd, 0), 0) ELSE 0 END,
    1
  )
  ON CONFLICT (user_id, day) DO UPDATE
    SET cost_usd = s.cost_usd + EXCLUDED.cost_usd,
        month_only_usd = s.month_only_usd + EXCLUDED.month_only_usd,
        calls = s.calls + 1,
        updated_at = now();
$$;

-- El CREATE vuelve a dar EXECUTE a `anon` y `authenticated` (privilegios por
-- defecto de Supabase en `public`): se quitan otra vez, como en
-- 20260915120000_ai_spend.sql.
REVOKE ALL ON FUNCTION public.record_ai_spend(uuid, numeric, boolean) FROM public;
REVOKE EXECUTE ON FUNCTION public.record_ai_spend(uuid, numeric, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_ai_spend(uuid, numeric, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_spend(uuid, numeric, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
