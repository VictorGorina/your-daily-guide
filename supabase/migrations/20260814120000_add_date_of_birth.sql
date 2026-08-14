-- Fecha de nacimiento: sustituye a la edad fija para poder recalcularla con
-- el paso del tiempo y adaptar el menú según cómo va cumpliendo años.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS date_of_birth date;
