-- Mensajes del chat perdidos de madrugada (ticket 36 de la auditoría, SEC-DB-12).
--
-- La política exigía `log_date = current_date`, y `current_date` es la fecha
-- en UTC. El cliente manda la fecha LOCAL: en España, de 00:00 a 01:00 (invierno)
-- o 02:00 (verano), ya es el día siguiente y el insert fallaba; en América pasa
-- al revés por la noche. El mensaje no se guardaba y desaparecía del historial.
--
-- Un día de margen a cada lado cubre cualquier zona horaria (UTC−12 a UTC+14)
-- sin dejar escribir en días lejanos.
-- Deshacer: supabase/rollbacks/20260928120000_chat_messages_date_window.sql.

BEGIN;

DROP POLICY IF EXISTS "insert today messages" ON public.chat_messages;
CREATE POLICY "insert today messages" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND log_date BETWEEN current_date - 1 AND current_date + 1);

COMMIT;
