-- Preferencia "ver calorías y macros" (ticket 01 de `precision-nutricional`,
-- decisión D3): cada persona decide si la app le enseña kcal, macros y
-- objetivos. Se pregunta en el onboarding y se cambia en Ajustes. Los platos se
-- siguen calculando igual con cualquiera de los dos valores; solo cambia lo que
-- se enseña. Lo lee `showsNutritionNumbers` (src/lib/macros.ts y su copia en
-- mobile/lib/macros.ts), nunca un componente directamente.
--
-- La columna la cubren las policies de `profiles` que ya existen (leer y
-- actualizar el perfil propio): no hacen falta nuevas.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nutrition_numbers text NOT NULL DEFAULT 'mostrar';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_nutrition_numbers_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_nutrition_numbers_check
      CHECK (nutrition_numbers IN ('mostrar', 'ocultar'));
  END IF;
END $$;

-- Relleno de las cuentas que ya existen (no han respondido la pregunta): quien
-- tiene `ed_history` activa o pasada ya no recibía cifras del coach, así que
-- sigue sin verlas; el resto sigue viéndolas. Nadie nota un cambio al
-- desplegar, y cualquiera lo cambia en Ajustes. Las cuentas nuevas eligen en el
-- onboarding: no se deduce de nada.
UPDATE public.profiles
  SET nutrition_numbers = 'ocultar'
  WHERE ed_history IN ('activa', 'pasada') AND nutrition_numbers = 'mostrar';

-- Comprobación (solo lectura), para pegar después:
--   SELECT nutrition_numbers, count(*) FROM public.profiles GROUP BY 1;
