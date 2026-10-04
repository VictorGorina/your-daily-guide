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

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

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
  supabase gen types typescript --project-id "$PROJECT_ID"
} > "$tmp"

# La CLI escribe sin `;` y el lint del repo incluye Prettier: se formatea aquí
# para que el resultado sea siempre el mismo.
bunx prettier --log-level warn --write "$tmp"

cp "$tmp" "$WEB"
cp "$tmp" "$MOBILE"
echo "Tipos regenerados: $WEB y $MOBILE"
