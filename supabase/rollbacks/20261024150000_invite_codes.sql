-- Deshace supabase/migrations/20261024150000_invite_codes.sql.
-- Aplicar a mano (`supabase db query --linked -f …`) y después
-- `supabase migration repair --status reverted 20261024150000`.
--
-- ANTES, revertir el código que llama a `create_household` y
-- `rotate_invite_code` (web y móvil), y deshacer también
-- 20261024150100_households_insert_via_rpc.sql si se llegó a aplicar: sin el
-- INSERT de vuelta, nadie podría crear un hogar.

DROP FUNCTION IF EXISTS public.create_household(text);
DROP FUNCTION IF EXISTS public.rotate_invite_code(uuid);
DROP FUNCTION IF EXISTS public.new_invite_code();

-- Las dos funciones de unión, como en 20260926120000_household_permissions.sql
-- (sin caducidad).
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
    WHERE upper(h.invite_code) = upper(trim(_invite_code));
  IF target IS NULL THEN
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
    WHERE upper(invite_code) = upper(trim(_invite_code));
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
  DELETE FROM public.household_members WHERE user_id = auth.uid();
  UPDATE public.household_members SET user_id = auth.uid() WHERE id = _member_id;
  RETURN target_household;
END;
$$;

CREATE INDEX IF NOT EXISTS households_invite_code_upper_idx
  ON public.households (upper(invite_code));
DROP INDEX IF EXISTS public.households_invite_code_upper_uniq;
ALTER TABLE public.households DROP COLUMN IF EXISTS invite_code_created_at;

NOTIFY pgrst, 'reload schema';
