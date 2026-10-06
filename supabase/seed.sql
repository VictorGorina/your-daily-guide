-- Datos de muestra del Supabase LOCAL (ticket 25 de la auditoría). `supabase
-- start` y `supabase db reset` lo cargan después de las migraciones; `supabase
-- db push` no lo toca, así que nunca llega a producción. Nada de aquí es real.
--
--   Ana   (ana@peppers.test)   planifica en su casa: un hueco sin cuenta
--                              (Leo), una peque (Vera) y el plan del mes.
--   Bruno (bruno@peppers.test) va por su cuenta, sin plan todavía.
--   Carla (carla@peppers.test) acaba de registrarse: sin onboarding.
--
-- Los tres entran con la contraseña de abajo. Solo vale en local: GoTrue la
-- compara con el hash que se guarda aquí, y esta base nace y muere en el CI o
-- en la máquina de quien la levanta.

DO $seed$
DECLARE
  pass constant text := 'peppers-local-1';
  ana constant uuid := '11111111-1111-4111-8111-111111111111';
  bruno constant uuid := '22222222-2222-4222-8222-222222222222';
  carla constant uuid := '33333333-3333-4333-8333-333333333333';
  home constant uuid := '44444444-4444-4444-8444-444444444444';
  month constant text := to_char(current_date, 'YYYY-MM');
  day_names constant text[] := ARRAY['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  lunches constant text[] := ARRAY[
    'Lentejas estofadas con verduras', 'Pollo al horno con patata y ensalada',
    'Arroz con verduras y huevo', 'Merluza a la plancha con brócoli',
    'Garbanzos con espinacas', 'Pasta integral con atún y tomate',
    'Ternera salteada con pimientos y arroz'];
  dinners constant text[] := ARRAY[
    'Tortilla francesa con ensalada de tomate', 'Crema de calabacín y pavo a la plancha',
    'Salmón al horno con judías verdes', 'Revuelto de champiñones con pan integral',
    'Ensalada completa de garbanzos y huevo', 'Sepia a la plancha con verduras',
    'Sopa de verduras y pechuga de pollo'];
  weeks jsonb := '[]'::jsonb;
  days jsonb;
BEGIN
  -- Cuentas con correo y contraseña. GoTrue lee los campos de texto como
  -- cadenas: tienen que ir vacíos, no NULL, o el inicio de sesión falla.
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
         extensions.crypt(pass, extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', u.full_name), now(), now(), '', '', '', ''
  FROM (VALUES (ana, 'ana@peppers.test', 'Ana'),
               (bruno, 'bruno@peppers.test', 'Bruno'),
               (carla, 'carla@peppers.test', 'Carla')) AS u(id, email, full_name);

  INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data,
                               last_sign_in_at, created_at, updated_at)
  SELECT gen_random_uuid(), u.id, u.id::text, 'email',
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         now(), now(), now()
  FROM auth.users u
  WHERE u.id IN (ana, bruno, carla);

  -- El perfil lo crea el trigger de alta (`handle_new_user`); aquí se rellena.
  UPDATE public.profiles SET
    display_name = 'Ana', sex = 'mujer', date_of_birth = '1990-05-14', age = 36,
    height_cm = 165, start_weight_kg = 68, current_weight_kg = 67, target_weight_kg = 62,
    goal_type = 'perder', daily_activity = 'de_pie', activity_level = 'ligero',
    meal_slots = ARRAY['desayuno', 'comida', 'cena', 'snack'],
    -- Al final del día: pasada esta hora, Hoy abre solo el repaso nocturno y
    -- taparía la pantalla al smoke E2E si el CI corre de noche.
    evening_time = '23:59',
    app_started_on = date_trunc('month', current_date)::date, onboarding_completed = true
  WHERE id = ana;
  UPDATE public.profiles SET
    display_name = 'Bruno', sex = 'hombre', date_of_birth = '1985-11-02', age = 40,
    height_cm = 180, start_weight_kg = 82, current_weight_kg = 82,
    goal_type = 'mantener', daily_activity = 'fisico', activity_level = 'activo',
    meal_slots = ARRAY['desayuno', 'comida', 'cena'],
    app_started_on = date_trunc('month', current_date)::date, onboarding_completed = true
  WHERE id = bruno;
  UPDATE public.profiles SET display_name = 'Carla' WHERE id = carla;

  -- La casa de Ana: ella planifica, Leo es un hueco aún sin reclamar y Vera, la peque.
  INSERT INTO public.households (id, name, invite_code, created_by)
  VALUES (home, 'Casa de Ana', 'SEEDANA1', ana);
  INSERT INTO public.household_members (household_id, user_id, role, display_name, is_planner)
  VALUES (home, ana, 'adulto', 'Ana', true);
  INSERT INTO public.household_members (household_id, user_id, role, display_name, uses_app)
  VALUES (home, NULL, 'adulto', 'Leo', true);
  INSERT INTO public.household_children (household_id, name)
  VALUES (home, 'Vera');

  -- El plan del mes en curso: 5 filas (`PLAN_ROWS`) de lunes a domingo, con
  -- los platos girando para que cada día tenga uno distinto.
  FOR w IN 0..4 LOOP
    SELECT jsonb_agg(jsonb_build_object(
             'day', day_names[d + 1],
             'lunch', lunches[(d + w) % 7 + 1],
             'dinner', dinners[(d + 2 * w) % 7 + 1]) ORDER BY d)
    INTO days
    FROM generate_series(0, 6) AS d;
    weeks := weeks || jsonb_build_object(
      'label', 'Semana ' || (w + 1),
      'focus', 'Legumbre dos veces y pescado dos veces',
      'breakfasts', jsonb_build_array('Yogur natural con avena y fruta', 'Tostada integral con tomate y huevo'),
      'snacks', jsonb_build_array('Fruta y un puñado de nueces', 'Yogur natural'),
      'days', days);
  END LOOP;

  INSERT INTO public.monthly_plans (user_id, month, plan, shopping)
  VALUES (ana, month,
          jsonb_build_object(
            'intro', 'Plan de muestra del Supabase local.',
            'focus', jsonb_build_array('Verdura en comida y cena', 'Proteína en cada comida'),
            'weeks', weeks,
            'cadence', 'semanal'),
          '[]'::jsonb);
END
$seed$;
