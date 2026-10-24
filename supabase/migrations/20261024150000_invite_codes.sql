-- Ticket 37 de la auditoría, punto 5 (SEC-DB-14, MOB-21): códigos de
-- invitación generados por el servidor, que caducan y se pueden cambiar.
-- Rollback: supabase/rollbacks/20261024150000_invite_codes.sql.
-- Tests: supabase/tests/invite_codes.test.sql.
--
-- Hasta ahora los generaba el cliente: la web con 8 caracteres criptográficos,
-- el móvil con `Math.random` y 6 (~30 bits); sin caducidad ni forma de cambiar
-- uno que se ha filtrado. Ahora:
--   - `create_household` crea el hogar, su código y la fila del creador como
--     planificador en UNA transacción (antes, si fallaba la segunda inserción,
--     quedaba un hogar huérfano);
--   - `rotate_invite_code` lo cambia (quien creó el hogar o quien planifica);
--   - un código de más de 30 días no vale para unirse
--     (`household_open_slots`, `claim_household_slot`): cuenta como uno malo.
--
-- Solo AÑADE: la beta del móvil instalada crea el hogar insertando ella misma y
-- sigue funcionando. Quitar ese INSERT espera a la build nueva:
-- supabase/pending/20261024150100_households_insert_via_rpc.sql.

-- 1. Cuándo se generó el código. Los de hoy empiezan a contar ahora. ----------
ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS invite_code_created_at timestamptz NOT NULL DEFAULT now();

-- 2. Único sin distinguir mayúsculas: la búsqueda ya usa upper(). Sustituye al
-- índice normal de 20260929120000_indexes.sql (comprobado el 2026-10-24: ningún
-- duplicado). El UNIQUE original (`households_invite_code_key`) se queda.
CREATE UNIQUE INDEX IF NOT EXISTS households_invite_code_upper_uniq
  ON public.households (upper(invite_code));
DROP INDEX IF EXISTS public.households_invite_code_upper_idx;

-- 3. Un código nuevo: 8 caracteres de un alfabeto sin ambiguos (sin 0/O ni 1/I).
-- 32 símbolos y 256 valores por byte: el módulo no sesga. 40 bits.
CREATE OR REPLACE FUNCTION public.new_invite_code()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '' ORDER BY i)
  FROM (SELECT extensions.gen_random_bytes(8) AS b) r, generate_series(0, 7) AS i;
$$;
REVOKE ALL ON FUNCTION public.new_invite_code() FROM public;
REVOKE EXECUTE ON FUNCTION public.new_invite_code() FROM anon;
REVOKE EXECUTE ON FUNCTION public.new_invite_code() FROM authenticated;

-- 4. Crear el hogar. ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_household(_name text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  household uuid;
  member_name text;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'Sin sesión' USING ERRCODE = '42501';
  END IF;

  -- Un código repetido (40 bits: casi imposible) se vuelve a sortear.
  FOR attempt IN 1..5 LOOP
    BEGIN
      INSERT INTO public.households (name, invite_code, invite_code_created_at, created_by)
      VALUES (coalesce(nullif(trim(_name), ''), 'Mi casa'), public.new_invite_code(), now(), me)
      RETURNING id INTO household;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF attempt = 5 THEN RAISE; END IF;
    END;
  END LOOP;

  SELECT left(coalesce(nullif(trim(p.display_name), ''), 'Yo'), 60) INTO member_name
    FROM public.profiles p WHERE p.id = me;

  -- Quien crea el hogar es su primer miembro y quien planifica. Si ya está en
  -- otro hogar, el índice único de `user_id` lo para y no queda nada creado.
  INSERT INTO public.household_members (household_id, user_id, role, display_name, is_planner)
  VALUES (household, me, 'adulto', coalesce(member_name, 'Yo'), true);

  RETURN household;
END;
$$;
REVOKE ALL ON FUNCTION public.create_household(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.create_household(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_household(text) TO authenticated;

-- 5. Cambiar el código (quien creó el hogar o quien planifica). ----------------
CREATE OR REPLACE FUNCTION public.rotate_invite_code(_household_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  code text;
BEGIN
  IF me IS NULL
     OR NOT (
       EXISTS (SELECT 1 FROM public.households h WHERE h.id = _household_id AND h.created_by = me)
       OR public.is_household_planner(_household_id, me)
     ) THEN
    RAISE EXCEPTION 'Solo quien creó el hogar o quien planifica puede cambiar el código'
      USING ERRCODE = '42501';
  END IF;

  FOR attempt IN 1..5 LOOP
    BEGIN
      UPDATE public.households
        SET invite_code = public.new_invite_code(), invite_code_created_at = now()
        WHERE id = _household_id
        RETURNING invite_code INTO code;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF attempt = 5 THEN RAISE; END IF;
    END;
  END LOOP;
  RETURN code;
END;
$$;
REVOKE ALL ON FUNCTION public.rotate_invite_code(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.rotate_invite_code(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rotate_invite_code(uuid) TO authenticated;

-- 6. Un código de más de 30 días no vale para unirse. -------------------------
-- Mismos cuerpos que en 20260926120000_household_permissions.sql; solo cambia
-- la búsqueda del hogar. Un código caducado cuenta como uno malo (límite de 10
-- intentos por hora), y para quien intenta unirse es igual que uno que no existe.
CREATE OR REPLACE FUNCTION public.household_open_slots(_invite_code text)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  att public.join_attempts%ROWTYPE;
  target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sin sesión';
  END IF;

  INSERT INTO public.join_attempts (user_id) VALUES (auth.uid())
    ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO att FROM public.join_attempts WHERE user_id = auth.uid() FOR UPDATE;
  IF att.window_start < now() - interval '1 hour' THEN
    UPDATE public.join_attempts SET attempts = 0, window_start = now()
      WHERE user_id = auth.uid() RETURNING * INTO att;
  END IF;
  IF att.attempts >= 10 THEN
    RAISE EXCEPTION 'Demasiados intentos, prueba más tarde';
  END IF;

  SELECT h.id INTO target FROM public.households h
    WHERE upper(h.invite_code) = upper(trim(_invite_code))
      AND h.invite_code_created_at > now() - interval '30 days';
  IF target IS NULL THEN
    -- Sin RAISE: una excepción desharía también este +1 (NUEVO-07).
    UPDATE public.join_attempts SET attempts = attempts + 1 WHERE user_id = auth.uid();
    RETURN;
  END IF;

  RETURN QUERY
    SELECT m.id, m.display_name
    FROM public.household_members m
    WHERE m.household_id = target AND m.user_id IS NULL AND m.uses_app
    ORDER BY m.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_household_slot(_invite_code text, _member_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_household uuid;
  slot_household uuid;
  slot_user uuid;
  slot_uses_app boolean;
  att public.join_attempts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sin sesión';
  END IF;

  INSERT INTO public.join_attempts (user_id) VALUES (auth.uid())
    ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO att FROM public.join_attempts WHERE user_id = auth.uid() FOR UPDATE;
  IF att.window_start < now() - interval '1 hour' THEN
    UPDATE public.join_attempts SET attempts = 0, window_start = now()
      WHERE user_id = auth.uid() RETURNING * INTO att;
  END IF;
  IF att.attempts >= 10 THEN
    RAISE EXCEPTION 'Demasiados intentos, prueba más tarde';
  END IF;

  SELECT id INTO target_household FROM public.households
    WHERE upper(invite_code) = upper(trim(_invite_code))
      AND invite_code_created_at > now() - interval '30 days';
  SELECT household_id, user_id, uses_app
    INTO slot_household, slot_user, slot_uses_app
    FROM public.household_members WHERE id = _member_id FOR UPDATE;

  IF target_household IS NULL
     OR slot_household IS DISTINCT FROM target_household
     OR slot_user IS NOT NULL
     OR NOT COALESCE(slot_uses_app, false) THEN
    UPDATE public.join_attempts SET attempts = attempts + 1 WHERE user_id = auth.uid();
    RETURN NULL;
  END IF;

  UPDATE public.join_attempts SET attempts = 0 WHERE user_id = auth.uid();
  -- Deja cualquier hogar anterior (dispara el traspaso de planificador allí).
  DELETE FROM public.household_members WHERE user_id = auth.uid();
  UPDATE public.household_members SET user_id = auth.uid() WHERE id = _member_id;
  RETURN target_household;
END;
$$;

NOTIFY pgrst, 'reload schema';
