#!/usr/bin/env bash
# Comprueba que el código compartido entre src/lib/ (web) y mobile/lib/ no haya
# divergido funcionalmente. Tres categorías (ticket 10 de la auditoría):
#
#  1. Idénticos byte a byte (`diff`): archivos sin imports que el móvil no tenga.
#  2. Iguales salvo imports y comentarios: se comparan normalizados.
#  3. plan-shared, export a export: la web lo tiene partido en src/lib/plan/ y
#     src/lib/shopping/; el móvil, en un solo archivo. La lista de exports está
#     en scripts/shared-exports.txt.
#
# Los archivos que divergen a propósito (daily.ts, household.ts,
# household-shared.ts, macros.ts, use-*.ts, i18n.ts, zoned-date.ts,
# recipe-warm.ts, exercise.ts, day-settle.ts, plan-recalc.ts,
# pending-chat-message.ts) NO se comprueban: tienen código de cada plataforma.
# Para vigilar uno nuevo, añádelo a la lista que le toque.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0

# --- Archivos que deben ser 100 % idénticos ---
for f in age.ts food-categories.ts dates.ts auth-cache.ts log-redact.ts; do
  if ! diff -q "src/lib/$f" "mobile/lib/$f" > /dev/null 2>&1; then
    echo "DRIFT (idéntico): $f"
    diff --unified=2 "src/lib/$f" "mobile/lib/$f" || true
    fail=1
  fi
done

# --- Archivos que difieren solo en imports / cabecera ---
# Se compara desde la primera línea que no sea import, comentario de cabecera
# ni línea vacía. Cualquier diferencia después de eso es drift funcional.
strip_portable() {
  # Quita lo que se espera distinto entre web y móvil: imports (también los de
  # varias líneas) y reexportaciones `export { … } from`, que solo cambian de
  # ruta; comentarios (// y bloques JSDoc) y líneas vacías.
  # Nota: BSD sed/awk (macOS) no soportan \s — usamos [[:space:]].
  awk '
    /^[[:space:]]*(import|export)[[:space:]]+(type[[:space:]]+)?\{/ || /^[[:space:]]*import[[:space:]]/ {
      if ($0 ~ /^[[:space:]]*export/ && $0 !~ /\}[[:space:]]*from|^[[:space:]]*export[[:space:]]+(type[[:space:]]+)?\{[^}]*$/) { print; next }
      if ($0 !~ /from[[:space:]]+["'\''].*["'\''];?[[:space:]]*$/ && $0 !~ /^[[:space:]]*import[[:space:]]+["'\'']/) skip=1
      next
    }
    skip { if ($0 ~ /from[[:space:]]+["'\'']/) skip=0; next }
    { print }
  ' "$1" | sed -E \
    -e '/^[[:space:]]*\/\//d' \
    -e '/^[[:space:]]*\/\*/d' \
    -e '/^[[:space:]]*\*.*$/d' \
    -e '/^[[:space:]]*$/d'
}

for f in perishability.ts quotes.ts profile-fields.ts day-log-ack.ts auth-errors.ts \
  demo-profile.ts regions.ts snacks.ts week-nav.ts content-guard.ts day-balance.ts \
  month-intake.ts use-shopping-mutation.ts sentry-scrub.ts; do
  a=$(strip_portable "src/lib/$f")
  b=$(strip_portable "mobile/lib/$f")
  if [ "$a" != "$b" ]; then
    echo "DRIFT (funcional): $f"
    diff <(echo "$a") <(echo "$b") || true
    fail=1
  fi
done

# --- Núcleo de nutrición puro (precision-nutricional): en la web vive en
# src/lib/nutrition/, en el móvil directamente en mobile/lib/.
for f in energy.ts exercise-energy.ts portion.ts dish-key.ts; do
  a=$(strip_portable "src/lib/nutrition/$f")
  b=$(strip_portable "mobile/lib/$f")
  if [ "$a" != "$b" ]; then
    echo "DRIFT (funcional): nutrition/$f"
    diff <(echo "$a") <(echo "$b") || true
    fail=1
  fi
done

# --- plan-shared, export a export ---
# También constantes y funciones privadas de las que dependen los exports (el
# 28-09 se escapó `DIA_NOMBRES`: el móvil la tenía en otro orden).
# Cuerpo de `(export )?(async )?(function|const) <nombre>`: desde esa línea hasta
# que los ({[ abiertos se cierran en una línea que acaba en ; o }.
extract_export() {
  awk -v name="$2" '
    !on && $0 ~ "^(export )?(async )?(function|const) " name "[^A-Za-z0-9_]" { on=1 }
    on {
      print
      line=$0; opens=gsub(/[({[]/, "", line)
      line=$0; closes=gsub(/[)}\]]/, "", line)
      depth += opens - closes
      if (depth <= 0 && $0 ~ /[;}][[:space:]]*$/) exit
    }
  ' "$1"
}

strip_comments() {
  # El `export ` inicial no cuenta: una copia puede exportar lo que la otra no.
  sed -E \
    -e 's/^export //' \
    -e '/^[[:space:]]*\/\//d' \
    -e '/^[[:space:]]*\/\*/d' \
    -e '/^[[:space:]]*\*.*$/d' \
    -e '/^[[:space:]]*$/d'
}

# Bloqueante desde el ticket 36 (MOB-07 portado). PLAN_SHARED_BLOCKING=0 lo
# deja en aviso, para investigar una deriva sin tumbar el CI en local.
PLAN_SHARED_BLOCKING="${PLAN_SHARED_BLOCKING:-1}"
web_plan_files=$(ls src/lib/plan/*.ts src/lib/shopping/*.ts | grep -v '\.test\.ts$')
while read -r name; do
  case "$name" in ''|'#'*) continue ;; esac
  # shellcheck disable=SC2086
  web_file=$(grep -lE "^(export )?(async )?(function|const) ${name}[^A-Za-z0-9_]" $web_plan_files | head -1 || true)
  if [ -z "$web_file" ] || ! grep -qE "^(export )?(async )?(function|const) ${name}[^A-Za-z0-9_]" mobile/lib/plan-shared.ts; then
    echo "DRIFT (plan-shared): $name ya no existe en las dos apps (actualiza scripts/shared-exports.txt)"
    fail=1
    continue
  fi
  a=$(extract_export "$web_file" "$name" | strip_comments)
  b=$(extract_export mobile/lib/plan-shared.ts "$name" | strip_comments)
  if [ "$a" != "$b" ]; then
    if [ "$PLAN_SHARED_BLOCKING" = "1" ]; then
      echo "DRIFT (plan-shared): $name ($web_file)"
      fail=1
    else
      echo "DRIFT (plan-shared, informativo): $name ($web_file)"
    fi
    diff <(echo "$a") <(echo "$b") || true
  fi
done < scripts/shared-exports.txt

# --- Catálogos i18n: mismas claves en ES/EN y en web/móvil (requiere jq) ---
# Los catálogos son intencionalmente un espejo exacto entre plataformas (a
# diferencia del resto de este script, que excluye lo que diverge a propósito):
# una clave que falte en un idioma o una copia deja ese texto sin traducir.
leaf_keys() {
  jq -r '[paths(scalars) | join(".")] | sort | .[]' "$1"
}

check_locale_pair() {
  local label="$1" file_a="$2" file_b="$3"
  local a b
  a=$(leaf_keys "$file_a")
  b=$(leaf_keys "$file_b")
  if [ "$a" != "$b" ]; then
    echo "DRIFT (claves $label): $file_a vs $file_b"
    diff <(echo "$a") <(echo "$b") || true
    fail=1
  fi
}

check_locale_pair "ES≠EN, web" src/locales/es.json src/locales/en.json
check_locale_pair "ES≠EN, móvil" mobile/locales/es.json mobile/locales/en.json
check_locale_pair "web≠móvil" src/locales/es.json mobile/locales/es.json

if [ "$fail" -eq 0 ]; then
  echo "✓ Todos los archivos compartidos están sincronizados"
fi

exit $fail
