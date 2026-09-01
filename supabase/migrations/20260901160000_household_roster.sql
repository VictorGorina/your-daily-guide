-- Familia — issue 01: los miembros del hogar pasan de "una fila = una persona con
-- cuenta" a "un hueco de la mesa", reclamado o no.
--
-- Un hueco adulto puede estar:
--   - sin reclamar y con app  (user_id NULL, uses_app true)  -> aparece en "¿quién eres?"
--   - sin app                  (user_id NULL, uses_app false) -> solo cuenta para la compra
--   - reclamado                (user_id NOT NULL)
-- Exactamente un miembro por hogar es el planificador (is_planner): su plan y su
-- lista de la compra son los del hogar.
--
-- Aplicar a mano en el SQL Editor (ver docs/agents/verification.md).

-- 1. Columnas nuevas ---------------------------------------------------------------
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS uses_app boolean NOT NULL DEFAULT true;
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS is_planner boolean NOT NULL DEFAULT false;
ALTER TABLE public.household_members
  ADD COLUMN IF NOT EXISTS portion numeric NOT NULL DEFAULT 1.0;

ALTER TABLE public.household_members DROP CONSTRAINT IF EXISTS household_members_portion_range;
ALTER TABLE public.household_members
  ADD CONSTRAINT household_members_portion_range CHECK (portion > 0 AND portion <= 20);

-- 2. Backfill --------------------------------------------------------------------
UPDATE public.household_members m
  SET display_name = COALESCE(NULLIF(TRIM(p.display_name), ''), 'Miembro')
  FROM public.profiles p
  WHERE p.id = m.user_id AND m.display_name IS NULL;

UPDATE public.household_members
  SET display_name = 'Miembro'
  WHERE display_name IS NULL;

ALTER TABLE public.household_members ALTER COLUMN display_name SET NOT NULL;

-- El creador del hogar es el planificador inicial.
UPDATE public.household_members m
  SET is_planner = true
  FROM public.households h
  WHERE h.id = m.household_id AND h.created_by = m.user_id;

-- 3. Clave primaria e índices --------------------------------------------------
ALTER TABLE public.household_members DROP CONSTRAINT IF EXISTS household_members_pkey;
ALTER TABLE public.household_members DROP CONSTRAINT IF EXISTS household_members_user_id_key;
ALTER TABLE public.household_members ADD PRIMARY KEY (id);
ALTER TABLE public.household_members ALTER COLUMN user_id DROP NOT NULL;

-- Un usuario sigue en un solo hogar; varios huecos sin reclamar (user_id NULL) conviven.
CREATE UNIQUE INDEX IF NOT EXISTS household_members_user_id_uniq
  ON public.household_members (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS household_members_household_id_idx
  ON public.household_members (household_id);

-- 4. Un único planificador por hogar, venga por donde venga el is_planner -------
CREATE OR REPLACE FUNCTION public.household_members_single_planner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_planner THEN
    -- Apaga a los demás. El UPDATE recursivo entra con NEW.is_planner = false,
    -- así que el IF de arriba corta la recursión.
    UPDATE public.household_members
      SET is_planner = false
      WHERE household_id = NEW.household_id
        AND id <> NEW.id
        AND is_planner;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS household_members_single_planner ON public.household_members;
CREATE TRIGGER household_members_single_planner
  AFTER INSERT OR UPDATE OF is_planner ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION public.household_members_single_planner();

-- 5. Traspaso automático de planificador (D3) ----------------------------------
-- Al miembro con cuenta de más edad: date_of_birth más antigua, luego age más
-- alta, luego el que lleva más tiempo en el hogar.
CREATE OR REPLACE FUNCTION public.household_assign_oldest_planner(_household_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = _household_id AND is_planner AND user_id IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  UPDATE public.household_members
    SET is_planner = true
    WHERE id = (
      SELECT m.id
      FROM public.household_members m
      LEFT JOIN public.profiles p ON p.id = m.user_id
      WHERE m.household_id = _household_id AND m.user_id IS NOT NULL
      ORDER BY p.date_of_birth ASC NULLS LAST, p.age DESC NULLS LAST, m.created_at ASC
      LIMIT 1
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.household_members_planner_handoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_planner THEN
    PERFORM public.household_assign_oldest_planner(OLD.household_id);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS household_members_planner_handoff ON public.household_members;
CREATE TRIGGER household_members_planner_handoff
  AFTER DELETE ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION public.household_members_planner_handoff();

-- Hogares cuyo creador ya se había ido antes de esta migración.
DO $$
DECLARE h record;
BEGIN
  FOR h IN
    SELECT id FROM public.households x
    WHERE NOT EXISTS (SELECT 1 FROM public.household_members m WHERE m.household_id = x.id AND m.is_planner)
  LOOP
    PERFORM public.household_assign_oldest_planner(h.id);
  END LOOP;
END $$;

-- 6. Reasignación manual: el creador (o el planificador actual) nombra a otro ---
CREATE OR REPLACE FUNCTION public.set_household_planner(_household_id uuid, _member_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed boolean;
  target_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sin sesión';
  END IF;

  SELECT (h.created_by = auth.uid())
       OR EXISTS (
         SELECT 1 FROM public.household_members m
         WHERE m.household_id = _household_id AND m.user_id = auth.uid() AND m.is_planner
       )
    INTO allowed
    FROM public.households h
    WHERE h.id = _household_id;

  IF NOT COALESCE(allowed, false) THEN
    RAISE EXCEPTION 'No puedes cambiar quién planifica';
  END IF;

  SELECT (user_id IS NOT NULL) INTO target_ok
    FROM public.household_members
    WHERE id = _member_id AND household_id = _household_id;

  IF NOT COALESCE(target_ok, false) THEN
    RAISE EXCEPTION 'Ese miembro no puede planificar (sin cuenta)';
  END IF;

  UPDATE public.household_members SET is_planner = true WHERE id = _member_id;
  -- El trigger household_members_single_planner apaga a los demás.
END;
$$;
REVOKE ALL ON FUNCTION public.set_household_planner(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.set_household_planner(uuid, uuid) TO authenticated;

-- 7. Unirse: elegir quién eres ------------------------------------------------
CREATE OR REPLACE FUNCTION public.household_open_slots(_invite_code text)
RETURNS TABLE (id uuid, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.display_name
  FROM public.household_members m
  JOIN public.households h ON h.id = m.household_id
  WHERE upper(h.invite_code) = upper(trim(_invite_code))
    AND m.user_id IS NULL
    AND m.uses_app
  ORDER BY m.created_at;
$$;
REVOKE ALL ON FUNCTION public.household_open_slots(text) FROM public;
GRANT EXECUTE ON FUNCTION public.household_open_slots(text) TO authenticated;

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

  -- Rate-limit compartido con join_household (H-02).
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
  IF target_household IS NULL THEN
    UPDATE public.join_attempts SET attempts = attempts + 1 WHERE user_id = auth.uid();
    RAISE EXCEPTION 'Código no válido';
  END IF;

  SELECT household_id, user_id, uses_app
    INTO slot_household, slot_user, slot_uses_app
    FROM public.household_members WHERE id = _member_id FOR UPDATE;

  IF slot_household IS DISTINCT FROM target_household
     OR slot_user IS NOT NULL
     OR NOT COALESCE(slot_uses_app, false) THEN
    UPDATE public.join_attempts SET attempts = attempts + 1 WHERE user_id = auth.uid();
    RAISE EXCEPTION 'Ese sitio ya no está disponible';
  END IF;

  UPDATE public.join_attempts SET attempts = 0 WHERE user_id = auth.uid();
  -- Deja cualquier hogar anterior (dispara el traspaso de planificador allí).
  DELETE FROM public.household_members WHERE user_id = auth.uid();
  UPDATE public.household_members SET user_id = auth.uid() WHERE id = _member_id;
  RETURN target_household;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_household_slot(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.claim_household_slot(text, uuid) TO authenticated;

-- 8. household_member_list con las columnas nuevas ---------------------------
DROP FUNCTION IF EXISTS public.household_member_list();
CREATE FUNCTION public.household_member_list()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  display_name text,
  role text,
  shared_meals jsonb,
  uses_app boolean,
  is_planner boolean,
  portion numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.user_id, m.display_name, m.role, m.shared_meals,
         m.uses_app, m.is_planner, m.portion
  FROM public.household_members m
  WHERE m.household_id = public.household_of(auth.uid())
    AND public.household_of(auth.uid()) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.household_member_list() FROM public;
GRANT EXECUTE ON FUNCTION public.household_member_list() TO authenticated;

-- 9. join_household antiguo: sigue vivo pero ahora rellena display_name (columna
-- NOT NULL). El flujo de "elegir quién eres" (claim_household_slot) lo sustituye
-- en la UI en el issue 02, que ya neutraliza esta función.
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
  who text;
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

  SELECT id INTO target FROM public.households
    WHERE upper(invite_code) = upper(trim(_invite_code));
  IF target IS NULL THEN
    UPDATE public.join_attempts SET attempts = attempts + 1 WHERE user_id = auth.uid();
    RAISE EXCEPTION 'Código no válido';
  END IF;

  SELECT COALESCE(NULLIF(TRIM(display_name), ''), 'Miembro') INTO who
    FROM public.profiles WHERE id = auth.uid();

  UPDATE public.join_attempts SET attempts = 0 WHERE user_id = auth.uid();
  DELETE FROM public.household_members WHERE user_id = auth.uid();
  INSERT INTO public.household_members (household_id, user_id, display_name)
    VALUES (target, auth.uid(), COALESCE(who, 'Miembro'));
  RETURN target;
END;
$$;

-- 10. RLS: el creador gestiona los huecos de su hogar ------------------------
DROP POLICY IF EXISTS "creator inserts household slots" ON public.household_members;
CREATE POLICY "creator inserts household slots"
  ON public.household_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id IS NULL
    AND EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "creator updates household slots" ON public.household_members;
CREATE POLICY "creator updates household slots"
  ON public.household_members FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid()));

DROP POLICY IF EXISTS "creator removes household slots" ON public.household_members;
CREATE POLICY "creator removes household slots"
  ON public.household_members FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.households h WHERE h.id = household_id AND h.created_by = auth.uid()));
