ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS life_context TEXT;

CREATE TABLE IF NOT EXISTS public.monthly_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  plan JSONB,
  shopping JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_plans TO authenticated;
GRANT ALL ON public.monthly_plans TO service_role;

ALTER TABLE public.monthly_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own monthly plans" ON public.monthly_plans FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER monthly_plans_updated_at BEFORE UPDATE ON public.monthly_plans
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();