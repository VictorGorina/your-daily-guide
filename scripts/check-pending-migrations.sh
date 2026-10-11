#!/usr/bin/env bash
# Las migraciones de supabase/pending/ no están aplicadas (ver su README), así
# que `supabase test db` no las ve. Esto comprueba que aun así siguen valiendo:
# cada una que tenga su test en supabase/pending/tests/ se aplica sobre la base
# de datos local, se corre su pgTAP en la MISMA transacción y se deshace todo
# (el `ROLLBACK` del test cierra la transacción que abre este script). La base
# de datos queda como estaba.
#
# Necesita el Supabase local en marcha (`supabase start`): en la práctica, el
# job `db` del CI. Usa el `psql` del contenedor de la base de datos.
# Sin migraciones pendientes con test no hace nada.
set -euo pipefail
cd "$(dirname "$0")/.."

container=$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -n 1)
if [ -z "$container" ]; then
  echo "No hay contenedor supabase_db_*: arranca antes el Supabase local." >&2
  exit 1
fi

status=0
found=0
for test in supabase/pending/tests/*.test.sql; do
  [ -e "$test" ] || continue
  name=$(basename "$test" .test.sql)
  migration="supabase/pending/$name.sql"
  if [ ! -f "$migration" ]; then
    echo "✗ $test no tiene su migración ($migration)" >&2
    status=1
    continue
  fi
  found=$((found + 1))
  echo "── $name"
  # El `BEGIN` del test avisa de que ya hay una transacción y sigue; su
  # `ROLLBACK` deshace también la migración.
  if out=$( { echo "BEGIN;"; cat "$migration"; cat "$test"; } |
      docker exec -i -e PGPASSWORD=postgres "$container" \
        psql -h 127.0.0.1 -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 2>&1); then
    echo "$out" | grep -E "^(ok|not ok|1\.\.)" || true
    planned=$(echo "$out" | sed -n 's/^1\.\.\([0-9][0-9]*\)$/\1/p' | head -n 1)
    passed=$(echo "$out" | grep -c "^ok [0-9]" || true)
    if [ -z "$planned" ] || [ "$passed" != "$planned" ]; then
      echo "✗ $name: pasan $passed de ${planned:-?} casos" >&2
      status=1
    fi
  else
    echo "$out"
    echo "✗ $name: la migración o su test han fallado" >&2
    status=1
  fi
done

echo "$found migración(es) pendiente(s) con test"
exit $status
