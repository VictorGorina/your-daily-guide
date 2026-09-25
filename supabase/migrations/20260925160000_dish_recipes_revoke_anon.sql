-- `increment_dish_recipe_hits` solo debe llamarla el servidor (clave de
-- servicio). El `REVOKE ALL ... FROM PUBLIC` de `20260925140000_dish_recipes.sql`
-- no bastaba: Supabase concede EXECUTE sobre las funciones nuevas a `anon` y
-- `authenticated` por su nombre (privilegios por defecto), y esas concesiones no
-- pasan por PUBLIC. Comprobado el 2026-09-25 con la clave publishable: la
-- llamada funcionaba. Es el mismo caso que `20260906140000_rate_limits_revoke_anon.sql`.
--
-- El daño posible era pequeño (inflar el contador de usos que ordena la
-- revisión manual), pero el diseño es que solo escriba el servidor.

REVOKE EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_dish_recipe_hits(text[]) TO service_role;
