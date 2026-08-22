-- H-12: Rangos numéricos razonables en datos de salud y presupuesto
ALTER TABLE public.profiles
  ADD CONSTRAINT weight_range
    CHECK (current_weight_kg IS NULL OR current_weight_kg BETWEEN 25 AND 400);

ALTER TABLE public.profiles
  ADD CONSTRAINT start_weight_range
    CHECK (start_weight_kg IS NULL OR start_weight_kg BETWEEN 25 AND 400);

ALTER TABLE public.profiles
  ADD CONSTRAINT height_range
    CHECK (height_cm IS NULL OR height_cm BETWEEN 50 AND 260);

ALTER TABLE public.profiles
  ADD CONSTRAINT budget_range
    CHECK (budget_month_eur IS NULL OR budget_month_eur BETWEEN 0 AND 100000);

ALTER TABLE public.profiles
  ADD CONSTRAINT goal_amount_range
    CHECK (goal_amount IS NULL OR goal_amount BETWEEN -200 AND 200);

-- H-13: Restringir role y longitud de contenido en chat_messages
ALTER TABLE public.chat_messages
  ADD CONSTRAINT role_valid CHECK (role IN ('user', 'assistant'));

ALTER TABLE public.chat_messages
  ADD CONSTRAINT content_len CHECK (char_length(content) <= 8000);

-- H-02: Tabla de intentos de unión a hogar (rate limiting de join_household)
CREATE TABLE IF NOT EXISTS public.join_attempts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  attempts int NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

-- Solo service_role necesita escribir aquí (lo hace el RPC SECURITY DEFINER)
ALTER TABLE public.join_attempts ENABLE ROW LEVEL SECURITY;

-- Reemplazar join_household con versión que limita intentos
CREATE OR REPLACE FUNCTION public.join_household(_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
  att public.join_attempts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sin sesión';
  END IF;

  -- Leer o crear registro de intentos
  INSERT INTO public.join_attempts (user_id)
    VALUES (auth.uid())
    ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO att FROM public.join_attempts
    WHERE user_id = auth.uid()
    FOR UPDATE;

  -- Reiniciar ventana si ha pasado más de 1 hora
  IF att.window_start < now() - interval '1 hour' THEN
    UPDATE public.join_attempts
      SET attempts = 0, window_start = now()
      WHERE user_id = auth.uid()
      RETURNING * INTO att;
  END IF;

  -- Bloquear si ha superado el límite
  IF att.attempts >= 10 THEN
    RAISE EXCEPTION 'Demasiados intentos, prueba más tarde';
  END IF;

  SELECT id INTO target FROM public.households
    WHERE upper(invite_code) = upper(trim(_invite_code));

  IF target IS NULL THEN
    UPDATE public.join_attempts SET attempts = attempts + 1
      WHERE user_id = auth.uid();
    RAISE EXCEPTION 'Código no válido';
  END IF;

  -- Éxito: reiniciar contador y unirse
  UPDATE public.join_attempts SET attempts = 0 WHERE user_id = auth.uid();
  DELETE FROM public.household_members WHERE user_id = auth.uid();
  INSERT INTO public.household_members (household_id, user_id)
    VALUES (target, auth.uid());
  RETURN target;
END;
$$;
