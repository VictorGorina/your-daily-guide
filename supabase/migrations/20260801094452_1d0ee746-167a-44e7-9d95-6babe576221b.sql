ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS budget_month_eur numeric;
ALTER TABLE public.monthly_plans ADD COLUMN IF NOT EXISTS confirmed_at timestamp with time zone;