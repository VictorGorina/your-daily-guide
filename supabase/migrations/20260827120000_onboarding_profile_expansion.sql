-- Amplía el perfil con las señales que hoy le faltaban al coach y al generador de
-- plan (ver análisis "Radiografía del onboarding"): seguridad (embarazo/lactancia,
-- relación con la comida, alcohol, gravedad de alergia), preferencias operativas del
-- día a día (aversiones, cocina, raciones, comidas a cubrir, utensilios, nivel de
-- cocina) y contexto de entrenamiento/hábitos (fuerza, suplementos, tabaco,
-- experiencia contando calorías, cadencia de pesaje). Todas nullable: perfiles
-- existentes se quedan con estos campos vacíos hasta que se editen.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pregnancy_status text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ed_history text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS alcohol text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS allergy_severity text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS disliked_foods text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cuisine_preference text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS portions_per_meal text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS meals_to_plan text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS kitchen_equipment text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cooking_skill text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS strength_training_experience text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS supplements text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS smoking text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tracking_experience text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS weigh_in_cadence text;
