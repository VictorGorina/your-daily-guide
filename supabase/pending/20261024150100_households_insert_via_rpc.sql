-- Ticket 37 de la auditoría, punto 5 (segunda parte): un hogar solo se crea con
-- `create_household` (20261024150000_invite_codes.sql).
-- Rollback: supabase/rollbacks/20261024150100_households_insert_via_rpc.sql.
-- Tests: supabase/pending/tests/20261024150100_households_insert_via_rpc.test.sql.
--
-- Mientras la sesión pueda insertar en `households`, cualquiera puede elegir su
-- propio código de invitación (uno fácil de adivinar, o el de otro hogar en
-- minúsculas antes del índice único) y saltarse el generador del servidor. La
-- función es SECURITY DEFINER: no necesita ni este privilegio ni las dos
-- policies de alta, que se quitan.
--
-- NO APLICAR mientras haya instalada una build del móvil anterior a la que
-- llama a `create_household`: esas builds insertan el hogar ellas mismas y
-- dejarían de poder crear uno. Ver supabase/pending/README.md.

REVOKE INSERT ON public.households FROM authenticated, anon;
DROP POLICY IF EXISTS "create household" ON public.households;
DROP POLICY IF EXISTS "creator seeds own household" ON public.household_members;
