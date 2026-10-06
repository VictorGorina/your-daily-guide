#!/usr/bin/env bash
# Comprueba contra el Supabase LOCAL (`supabase start`) que los datos de
# supabase/seed.sql valen para usar la app: Ana entra con su contraseña por
# GoTrue y, con esa sesión, PostgREST le devuelve su plan del mes y su mesa.
# Lo lanza el job `db` del CI (ticket 25 de la auditoría). Solo lee.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# API_URL y ANON_KEY del proyecto local; los avisos de servicios parados van
# por stderr.
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY)=')"

token="$(
  curl -sS --fail-with-body "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" -H "content-type: application/json" \
    -d '{"email":"ana@peppers.test","password":"peppers-local-1"}' | jq -r .access_token
)"
[ -n "$token" ] && [ "$token" != "null" ] || { echo "Ana no ha podido entrar." >&2; exit 1; }

read_count() {
  curl -sS --fail-with-body "$API_URL/rest/v1/$1" \
    -H "apikey: $ANON_KEY" -H "authorization: Bearer $token" | jq length
}

plans="$(read_count 'monthly_plans?select=month')"
members="$(read_count 'household_members?select=id')"
kids="$(read_count 'household_children?select=id')"
profiles="$(read_count 'profiles?select=id')"

echo "plan del mes: $plans · mesa: $members · peques: $kids · perfiles visibles: $profiles"
[ "$plans" = 1 ] && [ "$members" = 2 ] && [ "$kids" = 1 ] && [ "$profiles" = 1 ] || {
  echo "El seed no deja lo esperado (1 plan, 2 en la mesa, 1 peque, solo su perfil)." >&2
  exit 1
}
