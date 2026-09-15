-- Tope de gasto en IA por persona (complementa a `rate_limits`, no lo sustituye).
--
-- Las cuotas de `rate_limits` son por hora y por operación: una cuenta
-- automatizada que las respete todas puede gastar ~50-70 $/mes POR operación.
-- Esta tabla acumula lo que de verdad factura OpenRouter por cada llamada
-- (`usage.cost`), por persona y día UTC, y el servidor corta al llegar al tope
-- diario o mensual (`AI_SPEND_CAPS` en src/lib/rate-limit.server.ts; los topes
-- viven en código, no aquí, para ajustarlos sin migración).

CREATE TABLE IF NOT EXISTS public.ai_spend (
  -- Siempre el `sub` de un JWT ya verificado: lo pone el servidor, nunca el
  -- cliente. Al borrar la cuenta se va con ella.
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Día en UTC, el mismo corte que usa `decideSpendCap` (src/lib/ai-spend.ts).
  day date NOT NULL,
  -- `numeric` sin escala a propósito: cada llamada cuesta décimas de céntimo y
  -- redondear en cada suma acumularía error.
  cost_usd numeric NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  -- Para diagnosticar un tope alcanzado: pocas llamadas caras o un bucle.
  calls int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

-- RLS activada y ninguna policy: con la clave publishable nadie la lee ni la
-- escribe (mismo patrón que `rate_limits`). Además se quitan los privilegios
-- de tabla que Supabase concede por defecto a `anon` y `authenticated` en el
-- esquema `public`, para que no dependa solo de RLS. El servidor la usa con la
-- clave de servicio (`supabaseAdmin`), que no pasa por ninguna de las dos.
ALTER TABLE public.ai_spend ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_spend FROM anon, authenticated;

-- Suma el coste de una llamada al día UTC de hoy. Un único INSERT ... ON
-- CONFLICT para que dos llamadas simultáneas de la misma persona no se pisen
-- (leer y luego escribir perdería una de las dos sumas).
--
-- SECURITY INVOKER a propósito, al contrario que `consume_rate_limit`: se
-- ejecuta con los permisos de quien llama, así que aunque el EXECUTE volviera a
-- aparecer para `anon`/`authenticated` (lo haría un DROP + CREATE), el INSERT
-- fallaría igualmente por RLS y por los privilegios revocados arriba. No hace
-- falta mirar el rol del JWT dentro.
CREATE OR REPLACE FUNCTION public.record_ai_spend(_user_id uuid, _cost_usd numeric)
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

-- Para consultar a mano quién se acerca a los topes este mes (SQL Editor):
--   SELECT user_id, sum(cost_usd) AS usd, sum(calls) AS calls
--   FROM public.ai_spend
--   WHERE day >= date_trunc('month', now() AT TIME ZONE 'utc')::date
--   GROUP BY user_id ORDER BY usd DESC LIMIT 20;
