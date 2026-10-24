-- Tope de gasto en IA (20260915120000_ai_spend.sql y
-- 20261024120000_ai_spend_month_only.sql). `record_ai_spend` suma al día, con
-- `_month_only` también a la parte que solo mide el tope mensual; la llamada
-- antigua con dos argumentos sigue valiendo; y solo `service_role` la ejecuta.
-- Test de pgTAP; lo lanza `supabase test db`.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
VALUES ('e0000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', true, '{}'::jsonb,
        jsonb_build_object('full_name', 'VS'), now(), now());

-- ── Lo que suma ─────────────────────────────────────────────────────────────
-- La llamada del código ya desplegado: dos argumentos con nombre, como PostgREST.
SELECT public.record_ai_spend(_user_id => 'e0000000-0000-4000-a000-000000000001',
                              _cost_usd => 0.30);
SELECT is((SELECT (cost_usd, month_only_usd, calls)::text FROM public.ai_spend
           WHERE user_id = 'e0000000-0000-4000-a000-000000000001'),
          '(0.30,0,1)', 'S01 sin _month_only suma solo al día');

SELECT public.record_ai_spend('e0000000-0000-4000-a000-000000000001', 0.50, true);
SELECT is((SELECT (cost_usd, month_only_usd, calls)::text FROM public.ai_spend
           WHERE user_id = 'e0000000-0000-4000-a000-000000000001'),
          '(0.80,0.50,2)', 'S02 con _month_only suma al total y a la parte mensual');

SELECT public.record_ai_spend('e0000000-0000-4000-a000-000000000001', -1, true);
SELECT is((SELECT (cost_usd, month_only_usd, calls)::text FROM public.ai_spend
           WHERE user_id = 'e0000000-0000-4000-a000-000000000001'),
          '(0.80,0.50,3)', 'S03 un coste negativo cuenta la llamada pero no suma');

SELECT ok(public.ai_spend_total_today() >= 0.80,
          'S04 el disyuntor global suma también lo que solo mide el mensual');

SELECT throws_ok(
  $$ UPDATE public.ai_spend SET month_only_usd = cost_usd + 1
     WHERE user_id = 'e0000000-0000-4000-a000-000000000001' $$,
  '23514', NULL, 'S05 la parte mensual no puede pasar del total');

-- ── Quién la ejecuta ────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon',
            'public.record_ai_spend(uuid, numeric, boolean)', 'EXECUTE'),
          'S06 anon no la ejecuta');
SELECT ok(NOT has_function_privilege('authenticated',
            'public.record_ai_spend(uuid, numeric, boolean)', 'EXECUTE'),
          'S07 authenticated no la ejecuta');
SELECT ok(has_function_privilege('service_role',
            'public.record_ai_spend(uuid, numeric, boolean)', 'EXECUTE'),
          'S08 service_role sí');
SELECT is((SELECT count(*)::int FROM pg_proc
           WHERE proname = 'record_ai_spend' AND pronamespace = 'public'::regnamespace),
          1, 'S09 una sola versión de la función (sin la de dos argumentos)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.ai_spend', 'SELECT'),
          'S10 authenticated sigue sin leer la tabla');

SELECT * FROM finish();
ROLLBACK;
