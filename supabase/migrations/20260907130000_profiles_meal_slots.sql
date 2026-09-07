-- Issue 04: qué comidas quiere la persona que se le planifiquen deja de ser
-- solo una frase libre (`meals_to_plan`) que nada hacía cumplir. Esta columna
-- nueva guarda el conjunto exacto de slots elegidos, y es la que de verdad
-- usa `generateMonthlyPlan` para decidir qué le pide a la IA y qué pinta
-- Hoy/Plan (ver `effectiveMealSlots` en plan-shared.ts).
--
-- `meals_to_plan` NO se borra: sigue siendo el texto libre editable por el
-- coach (herramienta `actualizar_perfil`) y visible en "Mis respuestas".
-- `effectiveMealSlots` cae a interpretarlo cuando `meal_slots` está vacío, así
-- que un perfil antiguo (o editado solo por chat, sin tocar esta columna
-- nueva) sigue funcionando sin perder el dato.
--
-- Aplicar a mano en el SQL Editor (ver docs/agents/verification.md).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS meal_slots text[];

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_meal_slots_valid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_meal_slots_valid
  CHECK (meal_slots IS NULL OR meal_slots <@ ARRAY['desayuno', 'comida', 'cena', 'snack']::text[]);
