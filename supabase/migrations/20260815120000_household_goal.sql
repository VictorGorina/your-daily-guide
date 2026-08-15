-- Objetivo compartido del hogar: comportamiento (texto libre) o presupuesto (€/mes).
ALTER TABLE public.households ADD COLUMN IF NOT EXISTS goal_type text
  CHECK (goal_type IN ('comportamiento', 'presupuesto'));
ALTER TABLE public.households ADD COLUMN IF NOT EXISTS goal_text text;
ALTER TABLE public.households ADD COLUMN IF NOT EXISTS goal_budget_eur numeric;
