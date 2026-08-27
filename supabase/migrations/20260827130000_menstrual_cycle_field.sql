-- Pregunta condicional del onboarding (solo si sexo = mujer): si el ciclo
-- menstrual le afecta al apetito, la energía o los antojos, para que el coach
-- lo tenga en cuenta con delicadeza. Nullable y opcional, como el resto de
-- campos de "Radiografía del onboarding".

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS menstrual_cycle text;
