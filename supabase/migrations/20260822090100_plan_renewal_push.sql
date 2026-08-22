-- Marca de envío del aviso "genera el plan del mes que viene", para no
-- repetirlo más de una vez al día (mismo patrón que morning/evening_push_sent_on).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan_renewal_push_sent_on date;
