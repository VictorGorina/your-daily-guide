-- Fecha en la que se han "fijado" los ingredientes de un tramo de compra
-- (semana, quincena o mes según la cadencia): { [trip]: fechaISO }. Se guarda
-- a mano cuando la persona confirma que esos ingredientes ya están resueltos
-- (comprados o en casa) — como trip_actuals, pero para el estado de fijado.
ALTER TABLE public.monthly_plans ADD COLUMN IF NOT EXISTS confirmed_trips jsonb;
