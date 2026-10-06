#!/usr/bin/env bash
# Regenera los tipos de la base de datos a partir del esquema de producción
# (`bun run db:types`). Solo lee: pide el esquema a la API de Supabase con la
# sesión de `supabase login`; no hace falta la contraseña de la base de datos.
#
# Deja dos archivos idénticos, uno por app (no hay código compartido, ver
# AGENTS.md); `scripts/check-shared-drift.sh` vigila que sigan iguales:
#   src/integrations/supabase/types.ts
#   mobile/lib/database.types.ts
#
# Se lanza después de aplicar una migración (docs/agents/verification.md §3).
#
# Con `--check-local` (`bun run db:types:check`, job `db` del CI) no escribe
# nada: genera los tipos del Supabase LOCAL, que sale de aplicar
# supabase/migrations/ a una base vacía, y falla si no coinciden con los
# versionados. Así una migración sin `bun run db:types`, o un cambio hecho a
# mano en producción sin su migración, no pasa del CI.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MODE="${1:-}"
PROJECT_ID="tocmrlmxrwylyniyjtlv"
WEB="src/integrations/supabase/types.ts"
MOBILE="mobile/lib/database.types.ts"

# A un temporal dentro de la carpeta: si la CLI falla, el archivo versionado no
# se queda vacío, y Prettier encuentra el .prettierrc del repo.
tmp="src/integrations/supabase/.types.gen.ts"
trap 'rm -f "$tmp"' EXIT

{
  echo "// Generado por \`bun run db:types\` a partir del esquema de producción: no se edita a mano."
  echo "// Tras una migración se regenera; la copia del móvil es mobile/lib/database.types.ts."
  echo
  if [ "$MODE" = "--check-local" ]; then
    supabase gen types typescript --local
  else
    supabase gen types typescript --project-id "$PROJECT_ID"
  fi
} > "$tmp"

# La CLI escribe sin `;` y el lint del repo incluye Prettier: se formatea aquí
# para que el resultado sea siempre el mismo.
bunx prettier --log-level warn --write "$tmp"

if [ "$MODE" = "--check-local" ]; then
  # Se compara el ESQUEMA, no el texto: el generador de la API (el de
  # `bun run db:types`) y el de la imagen local escriben distinto lo mismo.
  # Fuera comentarios, la versión de PostgREST (es del servidor) y los
  # espacios; `NonNullable<Json>` y `Record<PropertyKey, never>` son lo que el
  # otro llama `Json` y `never`. Luego una línea por `;`, `{` o `}`, para que
  # una diferencia de verdad se lea columna a columna.
  schema_only() {
    perl -0pe '
      s/^\s*\/\/.*\n//mg;
      s/__InternalSupabase:\s*\{[^}]*\};?//;
      s/NonNullable<Json>/Json/g;
      s/Record<PropertyKey, never>/never/g;
      s/\s+//g;
      s/;\}/}/g;
      s/([;{}])/$1\n/g;
    ' "$1"
  }
  if diff -u <(schema_only "$WEB") <(schema_only "$tmp"); then
    echo "Los tipos versionados coinciden con las migraciones."
    exit 0
  fi
  echo "Los tipos versionados (-) no coinciden con lo que dejan las migraciones (+)." >&2
  echo "Tras una migración: bun run db:types, en el mismo commit." >&2
  exit 1
fi

cp "$tmp" "$WEB"
cp "$tmp" "$MOBILE"
echo "Tipos regenerados: $WEB y $MOBILE"
