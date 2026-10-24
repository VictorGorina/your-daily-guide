-- Ticket 37 de la auditoría, punto 2 (SEC-S-08): pre-secuestro de cuenta.
-- Rollback: supabase/rollbacks/20261024140000_auth_user_state.sql.
-- Tests: supabase/tests/auth_user_state.test.sql.
--
-- Si alguien crea una cuenta con tu correo y una contraseña suya y no la
-- confirma, al darte tú de alta `generateLink({ type: "signup", password })`
-- puede conservar la contraseña del primero, y al confirmar el enlace la cuenta
-- quedaría con ella. `requestSignupConfirmationHandler` (auth.server.ts) mira
-- aquí si ya hay una cuenta sin confirmar con ese correo y, si la hay, le pone
-- antes la contraseña de quien pide el enlace.
--
-- SECURITY DEFINER porque lee `auth.users`; solo `service_role` la ejecuta: con
-- la sesión de una persona sería un buscador de quién tiene cuenta. El correo
-- llega ya en minúsculas (el validador del servidor), como lo guarda GoTrue, y
-- así usa su índice. Las cuentas anónimas no tienen correo y no cuentan.

CREATE OR REPLACE FUNCTION public.auth_user_state(_email text)
RETURNS TABLE (id uuid, confirmed boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.email_confirmed_at IS NOT NULL
  FROM auth.users u
  WHERE u.email = lower(trim(_email)) AND NOT u.is_anonymous
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_user_state(text) FROM public;
REVOKE EXECUTE ON FUNCTION public.auth_user_state(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auth_user_state(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_state(text) TO service_role;
