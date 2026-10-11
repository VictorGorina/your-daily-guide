-- Ticket 40: cola de trabajos largos. Test de pgTAP de la migración PENDIENTE
-- `supabase/pending/20261011130000_jobs.sql`; lo lanza
-- `scripts/check-pending-migrations.sh` (job `db` del CI). El día que la
-- migración pase a `migrations/`, este archivo pasa a `supabase/tests/`.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(21);

SELECT set_config('request.jwt.claims', '', true);

-- Ejecuta `_sql` como `_uid` con el rol `_rol` y devuelve su primer valor
-- como texto, 'NULL' si no devuelve nada o 'ERR <sqlstate>' si falla.
CREATE FUNCTION pg_temp.vs_as(_uid uuid, _rol text, _sql text)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  r text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', _rol)::text, true);
  EXECUTE format('SET LOCAL ROLE %I', _rol);
  BEGIN
    EXECUTE _sql INTO r;
  EXCEPTION WHEN OTHERS THEN
    r := 'ERR ' || SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN coalesce(r, 'NULL');
END;
$f$;

INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
SELECT u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true,
       '{}'::jsonb, jsonb_build_object('full_name', 'VS'), now(), now()
FROM unnest(ARRAY['f0000000-0000-4000-a000-000000000001',
                  'f0000000-0000-4000-a000-000000000002']) AS u;

-- A: un trabajo en cola de hace 3 min. B: otro de hace 2 min.
INSERT INTO public.jobs (id, user_id, kind, input, created_at) VALUES
  ('f0000000-0000-4000-b000-000000000001', 'f0000000-0000-4000-a000-000000000001',
   'plan_generate', '{"month":"2026-11"}', now() - interval '3 minutes'),
  ('f0000000-0000-4000-b000-000000000002', 'f0000000-0000-4000-a000-000000000002',
   'plan_generate', '{"month":"2026-11"}', now() - interval '2 minutes');

-- ── Quién lee y quién escribe ───────────────────────────────────────────────
SELECT is(pg_temp.vs_as('f0000000-0000-4000-a000-000000000001', 'authenticated',
  $$ SELECT count(*) FROM public.jobs $$), '1', 'J01 una persona ve solo sus trabajos');
SELECT is(pg_temp.vs_as('f0000000-0000-4000-a000-000000000001', 'authenticated',
  $$ SELECT count(*) FROM public.jobs WHERE user_id = 'f0000000-0000-4000-a000-000000000002' $$),
  '0', 'J02 no ve los de otra');
SELECT is(pg_temp.vs_as('f0000000-0000-4000-a000-000000000001', 'anon',
  $$ SELECT count(*) FROM public.jobs $$), 'ERR 42501', 'J03 anon no lee la tabla');
SELECT is(pg_temp.vs_as('f0000000-0000-4000-a000-000000000001', 'authenticated',
  $$ INSERT INTO public.jobs (user_id, kind, input)
     VALUES ('f0000000-0000-4000-a000-000000000001', 'plan_fit', '{}') RETURNING id $$),
  'ERR 42501', 'J04 una persona no encola por su cuenta');
SELECT is(pg_temp.vs_as('f0000000-0000-4000-a000-000000000001', 'authenticated',
  $$ UPDATE public.jobs SET status = 'done', result = '{"x":1}' RETURNING id $$),
  'ERR 42501', 'J05 ni cambia el estado o el resultado del suyo');
SELECT is(pg_temp.vs_as('f0000000-0000-4000-a000-000000000001', 'authenticated',
  $$ DELETE FROM public.jobs RETURNING id $$), 'ERR 42501', 'J06 ni lo borra');
SELECT is(pg_temp.vs_as('f0000000-0000-4000-a000-000000000001', 'authenticated',
  $$ SELECT count(*) FROM public.claim_job() $$), 'ERR 42501',
  'J07 authenticated no puede reclamar trabajos');
SELECT is(pg_temp.vs_as('f0000000-0000-4000-a000-000000000001', 'anon',
  $$ SELECT count(*) FROM public.claim_job() $$), 'ERR 42501', 'J08 anon tampoco');

-- ── Un trabajo activo por persona y tipo ────────────────────────────────────
SELECT is(pg_temp.vs_as(NULL, 'service_role',
  $$ INSERT INTO public.jobs (user_id, kind, input)
     VALUES ('f0000000-0000-4000-a000-000000000001', 'plan_generate', '{}') RETURNING id $$),
  'ERR 23505', 'J09 no caben dos activos del mismo tipo para la misma persona');
SELECT isnt(pg_temp.vs_as(NULL, 'service_role',
  $$ INSERT INTO public.jobs (id, user_id, kind, input, created_at)
     VALUES ('f0000000-0000-4000-b000-000000000003', 'f0000000-0000-4000-a000-000000000001',
             'plan_fit', '{}', now() - interval '1 minute') RETURNING id $$),
  'ERR 23505', 'J10 pero sí uno de otro tipo');

-- ── claim_job ───────────────────────────────────────────────────────────────
SELECT is(pg_temp.vs_as(NULL, 'service_role',
  $$ SELECT id || ' ' || status || ' ' || attempts || ' ' || (locked_at IS NOT NULL)
     FROM public.claim_job() $$),
  'f0000000-0000-4000-b000-000000000001 running 1 true',
  'J11 reclama el más antiguo en cola y lo deja en marcha con su cerrojo');
SELECT is(pg_temp.vs_as(NULL, 'service_role', $$ SELECT id FROM public.claim_job() $$),
  'f0000000-0000-4000-b000-000000000002', 'J12 el siguiente, no el que ya está en marcha');
SELECT is(pg_temp.vs_as(NULL, 'service_role', $$ SELECT id FROM public.claim_job() $$),
  'f0000000-0000-4000-b000-000000000003', 'J13 y el tercero');
SELECT is(pg_temp.vs_as(NULL, 'service_role', $$ SELECT count(*) FROM public.claim_job() $$),
  '0', 'J14 sin nada en cola no reclama nada (los que están en marcha tienen cerrojo fresco)');

-- El trabajador de B termina con error: 'failed' no se reintenta nunca.
UPDATE public.jobs SET status = 'failed', error = 'x', locked_at = NULL
WHERE id = 'f0000000-0000-4000-b000-000000000002';
-- El de A murió hace 6 minutos sin terminar.
UPDATE public.jobs SET locked_at = now() - interval '6 minutes'
WHERE id = 'f0000000-0000-4000-b000-000000000001';

SELECT is(pg_temp.vs_as(NULL, 'service_role',
  $$ SELECT id || ' ' || attempts FROM public.claim_job() $$),
  'f0000000-0000-4000-b000-000000000001 2',
  'J15 un intento muerto (cerrojo caducado) se reclama otra vez');
SELECT is(pg_temp.vs_as(NULL, 'service_role', $$ SELECT count(*) FROM public.claim_job() $$),
  '0', 'J16 uno que terminó con error no se reintenta');

-- Tercer intento muerto: se acabó.
UPDATE public.jobs SET attempts = 3, locked_at = now() - interval '6 minutes'
WHERE id = 'f0000000-0000-4000-b000-000000000001';
SELECT is(pg_temp.vs_as(NULL, 'service_role', $$ SELECT count(*) FROM public.claim_job() $$),
  '0', 'J17 con los intentos agotados no se reclama');
SELECT is(
  (SELECT status || ' ' || error || ' ' || attempts FROM public.jobs
   WHERE id = 'f0000000-0000-4000-b000-000000000001'),
  'failed attempts_exhausted 3', 'J18 y queda como fallido, con el motivo');

-- Terminado el de A, ya puede encolar otro del mismo tipo.
SELECT isnt(pg_temp.vs_as(NULL, 'service_role',
  $$ INSERT INTO public.jobs (user_id, kind, input)
     VALUES ('f0000000-0000-4000-a000-000000000001', 'plan_generate', '{}') RETURNING id $$),
  'ERR 23505', 'J19 con el anterior terminado se puede encolar otro del mismo tipo');

-- ── Lo demás ────────────────────────────────────────────────────────────────
DELETE FROM auth.users WHERE id = 'f0000000-0000-4000-a000-000000000002';
SELECT is((SELECT count(*)::text FROM public.jobs
           WHERE user_id = 'f0000000-0000-4000-a000-000000000002'),
  '0', 'J20 al borrar la cuenta se van sus trabajos');
SELECT is((SELECT count(*)::text FROM cron.job WHERE jobname IN ('jobs-run', 'jobs-prune')),
  '2', 'J21 el disparo del trabajador y la limpieza están programados');

SELECT * FROM finish(true);
ROLLBACK;
