-- Cierra un agujero de la migración `rate_limits`: con solo la clave publishable
-- (que viaja en el bundle web y en la app móvil, es pública a propósito) se
-- podía llamar a `consume_rate_limit` pasando el `subject` de otra persona y
-- dejarla sin coach, sin plan y sin guía durante una hora. Ni siquiera hacía
-- falta tener cuenta.
--
-- Por qué no bastaba el `REVOKE ALL ON FUNCTION ... FROM public` que ya había:
-- Supabase concede EXECUTE sobre las funciones de `public` a `anon` y
-- `authenticated` mediante privilegios por defecto del esquema. Eso son
-- concesiones DIRECTAS a esos roles, y revocar del pseudo-rol PUBLIC no las
-- toca. El resto de funciones del proyecto (`join_household`,
-- `claim_household_slot`, ...) también son ejecutables por anon; están a salvo
-- porque comprueban `auth.uid()` por dentro. Esta no podía: el sujeto se lo dan
-- por parámetro, así que necesita las dos barreras de abajo.

-- 1) Quitar el EXECUTE a quien no debe tenerlo.
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, text, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, text, int, int) FROM authenticated;

-- 2) Barrera dentro de la función, por si el GRANT reaparece (lo haría un
--    DROP + CREATE, que vuelve a aplicar los privilegios por defecto). Se mira
--    el rol del JWT: `service_role` pasa, `anon`/`authenticated` no. Sin claims
--    (conexión directa a la base de datos, que exige la contraseña y por tanto
--    ya es más privilegiada que la clave pública) también pasa, para no
--    romper el mantenimiento manual.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  _subject text,
  _bucket text,
  _limit int,
  _window_seconds int
)
RETURNS TABLE (allowed boolean, retry_after_seconds int)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  win interval := make_interval(secs => _window_seconds);
  claim_role text;
  used int;
  started timestamptz;
BEGIN
  claim_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    ''
  );
  IF claim_role <> '' AND claim_role <> 'service_role' THEN
    RAISE EXCEPTION 'consume_rate_limit solo se llama desde el servidor';
  END IF;

  IF _subject IS NULL OR _bucket IS NULL OR _limit < 1 OR _window_seconds < 1 THEN
    RAISE EXCEPTION 'Parámetros de rate limit no válidos';
  END IF;

  -- Un único statement a propósito: el upsert bloquea la fila mientras decide
  -- si la ventana ha caducado (reinicia a 1) o sigue viva (incrementa). Leer y
  -- después escribir en dos pasos dejaría pasar las peticiones simultáneas, que
  -- es exactamente lo que hay que frenar.
  INSERT INTO public.rate_limits AS r (subject, bucket, attempts, window_start)
  VALUES (_subject, _bucket, 1, now())
  ON CONFLICT (subject, bucket) DO UPDATE
    SET attempts = CASE
          WHEN r.window_start < now() - win THEN 1
          ELSE r.attempts + 1
        END,
        window_start = CASE
          WHEN r.window_start < now() - win THEN now()
          ELSE r.window_start
        END
  RETURNING r.attempts, r.window_start INTO used, started;

  allowed := used <= _limit;
  retry_after_seconds := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (started + win - now())))::int);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, text, int, int) FROM public;
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, text, int, int) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_rate_limit(text, text, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, text, int, int) TO service_role;

-- Limpia las filas de las pruebas de verificación.
DELETE FROM public.rate_limits WHERE subject LIKE 'verify:%' OR subject = 'user:00000000-0000-0000-0000-000000000000';
