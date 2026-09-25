-- Entradas normalizadas del objetivo energético (ticket 07 de
-- `precision-nutricional`, D9). `activity_level` mezclaba el día a día con el
-- deporte en una sola frase y tenía cuatro vocabularios; ahora son dos datos:
--
-- - `daily_activity`: la actividad del día a día SIN deporte. Uno de
--   sentado · de_pie · fisico · muy_fisico (ver `PAL` en src/lib/nutrition/energy.ts).
-- - `training`: la rutina de entrenamiento habitual, en su forma corta
--   ("3 × 45 min · Gimnasio / pesas · Normal"; ver `parseTraining` en
--   src/lib/nutrition/exercise-energy.ts). Entra en el objetivo de cada día.
--
-- Las dos se quedan NULL en las cuentas que ya existen: mientras
-- `daily_activity` sea NULL, el objetivo usa `activity_level` normalizado (que
-- ya incluía el deporte) y no suma rutina. No hay relleno automático aquí.
-- Las policies de `profiles` que ya existen cubren las columnas nuevas.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS daily_activity text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS training text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_daily_activity_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_daily_activity_check
      CHECK (daily_activity IS NULL OR daily_activity IN ('sentado', 'de_pie', 'fisico', 'muy_fisico'));
  END IF;
END $$;
