#!/usr/bin/env bash
# Comprueba, después de `bun run build`, que nada pensado solo para el servidor
# ha acabado en el bundle del navegador: nombres de secretos, el cliente admin
# de Supabase, el system prompt del coach o la tabla de composición de
# alimentos. La protección de imports de vite.config.ts debería impedirlo; esto
# mira el resultado, no la configuración.
#
# Si existe $GITHUB_STEP_SUMMARY (CI), deja ahí el tamaño de la salida estática
# y los 10 chunks JS más grandes, para comparar tamaños entre builds.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Salida estática del preset `vercel` de Nitro (lo que se sirve al navegador).
STATIC_DIR=".vercel/output/static"

if [ ! -d "$STATIC_DIR" ]; then
  echo "No existe $STATIC_DIR: ejecuta antes \`bun run build\`." >&2
  exit 1
fi

markers=(
  # Nombres de variables de entorno secretas y el prefijo de una clave de OpenRouter.
  "SUPABASE_SERVICE_ROLE_KEY"
  "OPENROUTER_API_KEY"
  "RESEND_API_KEY"
  "VAPID_PRIVATE_KEY"
  "CRON_SECRET"
  "USDA_FDC_API_KEY"
  "sk-or-v1-"
  # Cliente de Supabase con service role (src/integrations/supabase/client.server.ts).
  "supabaseAdmin"
  "client.server"
  # Primera frase del system prompt, `coachSystemPrompt` en src/lib/ai-provider.server.ts.
  "Eres Peppers, un asistente de alimentación con IA"
  # Etiqueta que solo existe en src/lib/nutrition/foods.data.ts (la tabla de
  # composición no debe llegar al navegador). Si se renombra la fila, elegir otra
  # que no aparezca en ningún otro archivo de src/ ni de mobile/.
  "ternera magra"
)

fail=0
for marker in "${markers[@]}"; do
  hits=$(grep -rIlF -- "$marker" "$STATIC_DIR" || true)
  if [ -n "$hits" ]; then
    echo "MARCADOR DE SERVIDOR EN EL CLIENTE: \"$marker\""
    echo "$hits" | sed 's/^/  /'
    fail=1
  fi
done

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Bundle de cliente"
    echo
    echo "Tamaño total de \`$STATIC_DIR\`: $(du -sh "$STATIC_DIR" | cut -f1)"
    echo
    echo "| KB | Chunk |"
    echo "|---:|---|"
    find "$STATIC_DIR" -name '*.js' -exec du -k {} + | sort -rn | head -10 |
      awk '{ printf "| %s | `%s` |\n", $1, $2 }'
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$fail" -ne 0 ]; then
  echo "Hay código o secretos de servidor en el bundle del navegador (ver arriba)." >&2
  exit 1
fi

echo "OK: ningún marcador de servidor en $STATIC_DIR."
