#!/usr/bin/env bash
# Lanza el smoke E2E (Playwright) contra el Supabase LOCAL, que tiene que estar
# ya levantado con `supabase start` (aplica las migraciones y carga
# supabase/seed.sql). Saca de `supabase status` la URL y las claves locales y
# se las pasa a playwright.config.ts, que construye la app con ellas. Lo usa el
# job `e2e` del CI (ticket 25 de la auditoría). Los argumentos van a Playwright.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Los avisos de servicios parados van por stderr.
eval "$(supabase status -o env 2>/dev/null | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"

export E2E_SUPABASE_URL="$API_URL"
export E2E_SUPABASE_ANON_KEY="$ANON_KEY"
export E2E_SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"

exec bunx playwright test "$@"
