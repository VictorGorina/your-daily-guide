-- Per-member home schedule: each member/child says when they eat at home.
-- Replaces the single household-level `shared_slots` with individual schedules.
-- A meal is "effectively shared" when the planner + at least one other person
-- are both home for the same meal on the same day.

-- 1. Add home_schedule to members and children
ALTER TABLE household_members ADD COLUMN IF NOT EXISTS home_schedule jsonb;
ALTER TABLE household_children ADD COLUMN IF NOT EXISTS home_schedule jsonb;

-- 2. Backfill: each member/child inherits the current shared_slots of their
-- household. This preserves the existing behavior: if the household had
-- "comida shared on M-F", every member now says "I eat comida at home M-F".
UPDATE household_members m
  SET home_schedule = h.shared_slots
  FROM households h
  WHERE m.household_id = h.id
    AND m.home_schedule IS NULL
    AND h.shared_slots IS NOT NULL;

UPDATE household_children c
  SET home_schedule = h.shared_slots
  FROM households h
  WHERE c.household_id = h.id
    AND c.home_schedule IS NULL
    AND h.shared_slots IS NOT NULL;

-- 3. Keep households.shared_slots as a fallback — do NOT drop it.
COMMENT ON COLUMN households.shared_slots IS
  'DEPRECATED: replaced by per-member home_schedule on household_members/household_children. '
  'Kept as fallback for clients that have not updated yet.';

-- 4. Update household_member_list() to include home_schedule
DROP FUNCTION IF EXISTS public.household_member_list();
CREATE FUNCTION public.household_member_list()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  display_name text,
  role text,
  uses_app boolean,
  is_planner boolean,
  portion numeric,
  home_schedule jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.user_id, m.display_name, m.role,
         m.uses_app, m.is_planner, m.portion, m.home_schedule
  FROM public.household_members m
  WHERE m.household_id = public.household_of(auth.uid())
    AND public.household_of(auth.uid()) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.household_member_list() FROM public;
GRANT EXECUTE ON FUNCTION public.household_member_list() TO authenticated;
