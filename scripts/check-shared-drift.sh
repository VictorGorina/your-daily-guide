#!/usr/bin/env bash
# Comprueba que los archivos compartidos entre src/lib/ (web) y mobile/lib/
# no hayan divergido funcionalmente. Los que deben ser idénticos byte a byte
# se comparan con `diff`; los que difieren solo en imports y cabecera se
# comparan sin las primeras líneas de cada archivo.
#
# Archivos intencionalmente divergentes (daily.ts, plan-shared.ts,
# use-coach-actions.ts, household-shared.ts, macros.ts, etc.) NO se
# comprueban: tienen código específico de plataforma.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

fail=0

# --- Archivos que deben ser 100 % idénticos ---
for f in age.ts food-categories.ts; do
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
  # Elimina líneas que se esperan diferentes entre web y móvil: imports,
  # comentarios puros (// y bloques JSDoc) y líneas vacías. Así la comparación
  # se centra en el código funcional, no en la documentación ni los paths.
  # Nota: BSD sed (macOS) no soporta \s — usamos [[:space:]].
  sed -E \
    -e '/^[[:space:]]*import /d' \
    -e '/^[[:space:]]*\/\//d' \
    -e '/^[[:space:]]*\/\*/d' \
    -e '/^[[:space:]]*\*.*$/d' \
    -e '/^[[:space:]]*$/d' \
    "$1"
}

for f in perishability.ts quotes.ts profile-fields.ts; do
  a=$(strip_portable "src/lib/$f")
  b=$(strip_portable "mobile/lib/$f")
  if [ "$a" != "$b" ]; then
    echo "DRIFT (funcional): $f"
    diff <(echo "$a") <(echo "$b") || true
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "✓ Todos los archivos compartidos están sincronizados"
fi

exit $fail
