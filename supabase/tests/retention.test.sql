-- Ticket 30 (20261024170200_retention.sql): plazos de borrado que anuncia la
-- política de privacidad. Test de pgTAP; lo lanza `supabase test db`. Corre la
-- orden de cada trabajo tal como la guarda pg_cron.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(7);

INSERT INTO auth.users (id, instance_id, aud, role, is_anonymous, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at)
VALUES ('c5000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', true, '{}'::jsonb,
        jsonb_build_object('full_name', 'VS'), now(), now());

INSERT INTO public.chat_messages (user_id, log_date, role, content, created_at)
VALUES ('c5000000-0000-4000-a000-000000000001', current_date - 181, 'user', 'viejo',
        now() - interval '181 days'),
       ('c5000000-0000-4000-a000-000000000001', current_date - 179, 'user', 'reciente',
        now() - interval '179 days');
INSERT INTO public.rate_limits (subject, bucket, attempts, window_start)
VALUES ('user:c5000000-0000-4000-a000-000000000001', 'retention-viejo', 1, now() - interval '8 days'),
       ('user:c5000000-0000-4000-a000-000000000001', 'retention-reciente', 1, now() - interval '6 days');

SELECT is((SELECT count(*)::int FROM cron.job
           WHERE jobname IN ('retention-chat', 'retention-rate-limits',
                             'retention-join-attempts', 'retention-ai-spend')),
          4, 'R01 los cuatro trabajos están programados');
SELECT is((SELECT schedule FROM cron.job WHERE jobname = 'retention-chat'), '30 3 * * *',
          'R02 el del chat, cada noche a las 03:30 UTC');

DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'retention-chat'); END $$;
DO $$ BEGIN EXECUTE (SELECT command FROM cron.job WHERE jobname = 'retention-rate-limits'); END $$;

SELECT is((SELECT count(*)::int FROM public.chat_messages
           WHERE user_id = 'c5000000-0000-4000-a000-000000000001' AND content = 'viejo'),
          0, 'R03 un mensaje de hace más de 180 días se borra');
SELECT is((SELECT count(*)::int FROM public.chat_messages
           WHERE user_id = 'c5000000-0000-4000-a000-000000000001' AND content = 'reciente'),
          1, 'R04 uno más nuevo se queda');
SELECT is((SELECT count(*)::int FROM public.rate_limits WHERE bucket = 'retention-viejo'),
          0, 'R05 una cuota de hace más de 7 días se borra');
SELECT is((SELECT count(*)::int FROM public.rate_limits WHERE bucket = 'retention-reciente'),
          1, 'R06 una más nueva se queda');
SELECT lives_ok(
  $$ DO $d$ BEGIN
       EXECUTE (SELECT command FROM cron.job WHERE jobname = 'retention-join-attempts');
       EXECUTE (SELECT command FROM cron.job WHERE jobname = 'retention-ai-spend');
     END $d$ $$,
  'R07 las órdenes de los intentos de unirse y del gasto corren');

SELECT * FROM finish();
ROLLBACK;
