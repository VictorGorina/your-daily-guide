# 05 — Pulido y coste (DIFERIDA)

Status: superseded — anclas de ración y eval absorbidos en `.scratch/precision-nutricional/` (tickets 02 y 05); el prompt-cache deja de hacer falta al quitar `FOOD_KEYS` del prompt

## Qué

- Prompt-cache de los bloques estáticos (system prompt, lista de `key`s de `foods`) en la
  llamada de `dishToIngredients`.
- Anclas de ración más finas en ese prompt (reduce el único error que queda: tamaño de
  ración estimado).
- Few-shot (1-2 ejemplos de fragmento bueno de 3 días) en el prompt de generación del plan.
- `eval:plan` como workflow de GitHub Actions de disparo manual, patrón de
  `.github/workflows/push-dispatch.yml`.
