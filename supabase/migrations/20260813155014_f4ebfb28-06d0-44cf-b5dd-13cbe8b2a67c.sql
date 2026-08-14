ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS family_context text;

CREATE OR REPLACE FUNCTION public.household_member_list()
RETURNS TABLE (user_id uuid, display_name text, role text, shared_meals jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.user_id, p.display_name, m.role, m.shared_meals
  FROM public.household_members m
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.household_id = public.household_of(auth.uid())
    AND public.household_of(auth.uid()) IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.household_member_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.household_member_list() TO authenticated;