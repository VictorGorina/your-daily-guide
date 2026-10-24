-- Ticket 29 de la auditoría, punto 5 (SEC-S-01): borrado de las cuentas
-- anónimas (el perfil demo) que llevan 30 días sin usarse.
-- Rollback: supabase/rollbacks/20261024160000_purge_anonymous.sql.
-- Tests: supabase/tests/purge_anonymous.test.sql.
--
-- Una cuenta anónima se crea desde el navegador sin correo ni contraseña: si
-- se pierde su sesión, nadie puede volver a entrar en ella. Sin esto se
-- acumulan para siempre, con sus datos (perfil, plan, días, chat).
--
-- "Sin usarse" NO es `last_sign_in_at`: renovar el token no la cambia, así que
-- un demo que se abre a diario conserva la fecha de su alta y el SQL del
-- ticket lo habría borrado en uso. Cuenta también la última renovación de
-- cualquiera de sus sesiones (`auth.sessions`; `refreshed_at` es `timestamp`
-- sin zona y GoTrue lo escribe en UTC).
--
-- Al borrar la fila de `auth.users` cae todo en cascada (las diez tablas de
-- `public` con `user_id` o `id` hacia ella; `households.created_by` pasa a
-- NULL). En un hogar con más gente, `household_members_planner_handoff` pasa
-- la planificación a otro y `households_gc` solo borra el hogar si ya no queda
-- nadie con cuenta (ticket 36). Las cuotas por hora no cuelgan de
-- `auth.users` (el sujeto es texto): se borran aquí, como en `deleteAccount`.

BEGIN;

CREATE OR REPLACE FUNCTION public.purge_inactive_anonymous_users(_max integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _ids uuid[];
BEGIN
  -- Como mucho `_max` por pasada (las más antiguas primero): cada borrado
  -- arrastra varias tablas, y un atasco acumulado se vacía en unas noches sin
  -- una transacción enorme.
  SELECT coalesce(array_agg(x.id), '{}') INTO _ids
  FROM (
    SELECT u.id
    FROM auth.users u
    WHERE u.is_anonymous IS TRUE
      AND greatest(u.created_at, u.last_sign_in_at) < now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM auth.sessions s
        WHERE s.user_id = u.id
          AND greatest(s.created_at, s.updated_at, s.refreshed_at AT TIME ZONE 'UTC')
              >= now() - interval '30 days'
      )
    ORDER BY greatest(u.created_at, u.last_sign_in_at)
    LIMIT greatest(_max, 0)
  ) x;

  DELETE FROM public.rate_limits
  WHERE subject IN (SELECT 'user:' || id::text FROM unnest(_ids) AS id);

  DELETE FROM auth.users WHERE id = ANY (_ids) AND is_anonymous IS TRUE;

  RETURN cardinality(_ids);
END;
$$;

-- Solo la llama el cron (como `postgres`, su dueño): nadie por RPC, tampoco
-- el servidor.
REVOKE ALL ON FUNCTION public.purge_inactive_anonymous_users(integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- 03:15 UTC, entre `jobs-prune` (03:17) y el resto de la limpieza nocturna.
SELECT cron.schedule(
  'purge-anon-users',
  '15 3 * * *',
  $$SELECT public.purge_inactive_anonymous_users()$$
);

COMMIT;
