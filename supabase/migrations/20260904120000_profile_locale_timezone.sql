-- País, idioma y zona horaria por persona. Hasta ahora la app asumía una sola
-- realidad (España / español / euro / Europe/Madrid): "hoy" se calculaba con el
-- reloj de Madrid y las notificaciones se disparaban en esa misma hora para
-- todo el mundo. Con estos campos cada perfil lleva su contexto:
--
--   locale    -- idioma de la interfaz y del coach ('es' | 'en' de momento)
--   timezone  -- zona IANA detectada del dispositivo; el corte del día y la
--                ventana del push matutino/nocturno se calculan contra ella
--   country   -- ISO-3166 alpha-2, elegido en el onboarding (lista corta curada)
--   currency  -- moneda para formatear importes y para el contexto de precios
--                que se le pasa al coach ('EUR' | 'GBP' | 'USD'...)
--
-- Los perfiles que ya existen se quedan con los valores por defecto, que son
-- exactamente su realidad actual — no hace falta backfill.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale   text NOT NULL DEFAULT 'es';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Madrid';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country  text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR';

-- Nota: la columna `budget_month_eur` conserva el nombre por compatibilidad,
-- pero su valor pasa a interpretarse "en la moneda de `currency`".
