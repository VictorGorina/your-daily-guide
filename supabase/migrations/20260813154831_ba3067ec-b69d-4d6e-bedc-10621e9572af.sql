-- Perfil: contexto familiar
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS family_context text;

-- Hogares
CREATE TABLE public.households (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL DEFAULT 'Mi casa',
  invite_code text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.households TO authenticated;
GRANT ALL ON public.households TO service_role;

CREATE TABLE public.household_members (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'adulto',
  shared_meals jsonb NOT NULL DEFAULT '{"desayuno": [], "comida": [], "cena": [0,1,2,3,4,5,6]}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id),
  UNIQUE (user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_members TO authenticated;
GRANT ALL ON public.household_members TO service_role;

CREATE TABLE public.household_children (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  name text NOT NULL,
  age integer,
  allergies text,
  appetite text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.household_children TO authenticated;
GRANT ALL ON public.household_children TO service_role;

-- Helpers sin recursión de RLS
CREATE OR REPLACE FUNCTION public.is_household_member(_household_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.household_members
    WHERE household_id = _household_id AND user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.household_of(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT household_id FROM public.household_members WHERE user_id = _user_id LIMIT 1
$$;

-- Unirse con código sin exponer los hogares ajenos
CREATE OR REPLACE FUNCTION public.join_household(_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sin sesión';
  END IF;
  SELECT id INTO target FROM public.households
    WHERE upper(invite_code) = upper(trim(_invite_code));
  IF target IS NULL THEN
    RAISE EXCEPTION 'Código no válido';
  END IF;
  DELETE FROM public.household_members WHERE user_id = auth.uid();
  INSERT INTO public.household_members (household_id, user_id)
    VALUES (target, auth.uid());
  RETURN target;
END;
$$;
REVOKE ALL ON FUNCTION public.join_household(text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_household(text) TO authenticated;

ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_children ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read own household" ON public.households FOR SELECT TO authenticated
  USING (public.is_household_member(id, auth.uid()) OR created_by = auth.uid());
CREATE POLICY "create household" ON public.households FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "update own household" ON public.households FOR UPDATE TO authenticated
  USING (public.is_household_member(id, auth.uid()))
  WITH CHECK (public.is_household_member(id, auth.uid()));
CREATE POLICY "delete own household" ON public.households FOR DELETE TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY "read household members" ON public.household_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_household_member(household_id, auth.uid()));
CREATE POLICY "join household" ON public.household_members FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "update own membership" ON public.household_members FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "leave household" ON public.household_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "manage household children" ON public.household_children FOR ALL TO authenticated
  USING (public.is_household_member(household_id, auth.uid()))
  WITH CHECK (public.is_household_member(household_id, auth.uid()));

CREATE TRIGGER households_updated_at BEFORE UPDATE ON public.households
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER household_members_updated_at BEFORE UPDATE ON public.household_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER household_children_updated_at BEFORE UPDATE ON public.household_children
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();