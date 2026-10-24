-- Deshace supabase/migrations/20261024140000_auth_user_state.sql.
-- Aplicar a mano (`supabase db query --linked -f …`) y después
-- `supabase migration repair --status reverted 20261024140000`.
--
-- Sin la función, el alta sigue funcionando: `supabaseAdmin.rpc` devuelve un
-- error, `requestSignupConfirmationHandler` no ve ninguna cuenta previa y no
-- toca contraseñas (vuelve el riesgo de pre-secuestro, nada más).

DROP FUNCTION IF EXISTS public.auth_user_state(text);
