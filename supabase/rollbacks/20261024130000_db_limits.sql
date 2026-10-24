-- Deshace supabase/migrations/20261024130000_db_limits.sql.
-- Aplicar a mano (`supabase db query --linked -f …`) y después
-- `supabase migration repair --status reverted 20261024130000`.
-- Los clientes funcionan con los dos estados.

DROP TRIGGER IF EXISTS daily_logs_date_immutable ON public.daily_logs;
DROP FUNCTION IF EXISTS public.daily_logs_date_immutable();

ALTER TABLE public.households DROP CONSTRAINT IF EXISTS households_name_len;
ALTER TABLE public.household_members DROP CONSTRAINT IF EXISTS members_name_len;
ALTER TABLE public.household_children DROP CONSTRAINT IF EXISTS children_name_len;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_name_len;
ALTER TABLE public.daily_logs DROP CONSTRAINT IF EXISTS daily_logs_json_size;
ALTER TABLE public.monthly_plans DROP CONSTRAINT IF EXISTS monthly_plans_json_size;
