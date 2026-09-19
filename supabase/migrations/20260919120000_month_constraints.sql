CREATE TABLE IF NOT EXISTS public.month_constraints (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  away_start DATE,
  away_end DATE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.month_constraints TO authenticated;
GRANT ALL ON public.month_constraints TO service_role;

ALTER TABLE public.month_constraints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own month constraints" ON public.month_constraints FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER month_constraints_updated_at BEFORE UPDATE ON public.month_constraints
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
