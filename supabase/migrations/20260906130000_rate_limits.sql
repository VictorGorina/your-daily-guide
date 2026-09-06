-- Rate limiting duradero para las operaciones caras (las que llaman a la IA) y
-- para recuperar la contraseña.
--
-- Por qué vive en la base de datos y no en memoria del proceso: la web se
-- despliega en funciones serverless, donde cada instancia tiene su propia
-- memoria. Un contador en un Map frena los clics repetidos de una persona pero
-- no un abuso repartido entre instancias, que es justo el caso que cuesta
-- dinero (cada petición a /api/chat o a generar plan es una llamada de pago a
-- OpenRouter). La tabla es el único sitio compartido que ya tenemos.
--
-- Es el mismo enfoque que `join_attempts` (H-02), generalizado a cualquier
-- operación en vez de solo a unirse a un hogar.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  -- Quién gasta la cuota. Siempre lo construye el servidor a partir de datos ya
  -- verificados: "user:<uuid>" con el `sub` del JWT, o "email:<sha256>" para lo
  -- que se pide sin sesión. El correo va hasheado a propósito: así esta tabla
  -- no guarda datos personales en claro ni sirve para averiguar quién tiene
  -- cuenta si algún día se filtrara.
  subject text NOT NULL,
  -- Qué operación se limita ("chat", "plan-generate", ...). Los límites de cada
  -- una viven en RATE_LIMITS, en src/lib/rate-limit.server.ts, no aquí: así se
  -- ajustan sin migración.
  bucket text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (subject, bucket)
);

-- Sin políticas a propósito: con RLS activada y ninguna policy, nadie que use
-- la clave publishable puede leerla ni escribirla. Solo la toca
-- `consume_rate_limit`, que se llama con la clave de servicio desde el
-- servidor. Mismo patrón que `join_attempts`.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Por si algún día se quiere barrer ventanas viejas; las filas son una por
-- (persona × operación), así que la tabla no crece sola.
CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx
  ON public.rate_limits (window_start);

-- Consume un intento y dice si la petición pasa. Ventana fija: la primera
-- petición abre la ventana y a partir de ahí se cuenta hasta que caduca.
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
  used int;
  started timestamptz;
BEGIN
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

-- Solo el servidor. Si se pudiera llamar con la sesión de una persona, esa
-- persona podría gastarle la cuota a otra pasando su `subject`.
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, text, int, int) TO service_role;
