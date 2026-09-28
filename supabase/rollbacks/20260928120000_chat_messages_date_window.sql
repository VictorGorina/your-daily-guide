-- Deshace supabase/migrations/20260928120000_chat_messages_date_window.sql.
-- Aplicar a mano en el SQL Editor. Vuelve el fallo de madrugada: los mensajes
-- escritos entre las 00:00 locales y las 00:00 UTC no se guardan.

BEGIN;

DROP POLICY IF EXISTS "insert today messages" ON public.chat_messages;
CREATE POLICY "insert today messages" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND log_date = current_date);

COMMIT;
