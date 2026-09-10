# 00 — Banco de pruebas del plan + línea base

Status: done parcial (2026-09-10) — hecho el banco de **cobertura de platos**; el banco de
**plan completo** (fixtures de perfil + `generatePlanBody` + presupuesto/variedad) se hará
junto con la Fase 3, cuando `generatePlanBody` se pueda invocar sin auth.

## Lo hecho

`src/lib/plan-eval/dishes.data.ts` (50 platos representativos) + `dish-coverage.ts` +
`bun run eval:dishes`. Mide, con llamadas reales al modelo: % de platos descompuestos,
calidad media (gramos identificados con confianza alta), kcal/ración fuera de rango, e
ingredientes sin identificar (candidatos a la tabla). Escribe `baseline.json`.
Línea base 2026-09-10: **50/50, 100 % calidad, 0 fuera de rango.**

## Lo que queda (con la Fase 3)

## Qué

`src/lib/plan-eval/` — script de evaluación de calidad de la salida de IA. No es un test
unitario (gasta llamadas al modelo); se corre a mano con `bun run eval:plan`.

### Perfiles fijos — `src/lib/plan-eval/fixtures/*.json`
~10 perfiles que cubran los casos duros:
`vegetariano`, `alergia-frutos-secos`, `presupuesto-150`, `familia-4-mas-bebe`,
`embarazo`, `ganar-masa`, `celiaco`, `sin-objetivo`, `cocina-sin-horno`,
`no-planificador-hogar`.

### Runner — `src/lib/plan-eval/run.ts`
Por cada perfil: llama a `generatePlanBody` (o al pipeline que toque), y puntúa:

| Métrica | Cómo |
|---|---|
| Presupuesto | `shoppingTotal` vs `budget_month_eur` prorrateado. % de desvío. |
| kcal | RMSE del kcal/día del plan (vía `dishToIngredients` + `macrosOf`) vs objetivo Mifflin-St Jeor del perfil. |
| Variedad | platos distintos / total de slots. |
| Violaciones duras | alérgeno / patrón de dieta que aparece en algún plato (detectado con `dishToIngredients`). Cualquiera = fallo. |
| Coherencia | todo ingrediente de un plato ∈ (compra + despensa). |

Imprime una tabla. Guarda el JSON de resultados en `src/lib/plan-eval/baseline.json`.

### `package.json`
`"eval:plan": "bun src/lib/plan-eval/run.ts"`.

## Orden

Se implementa **después del 01** (necesita `dishToIngredients` para medir kcal y
violaciones), pero **antes de tocar `generatePlanBody`** en fases posteriores, para tener la
foto del pipeline actual.

## Hecho cuando
`bun run eval:plan` corre los ~10 perfiles y escribe `baseline.json` con los números del
pipeline actual.
