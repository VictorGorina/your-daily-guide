# 04 — Casado v2: candidatos, categoría y platos dentro de ingredientes

Status: ready
Blocked by: 03
Tamaño: M
Fase: 3

## Qué

Sustituir el `matchFood` de "gana el primero con más tokens" por un casado que devuelve
**candidatos puntuados**, sabe cuándo duda y reconoce cuándo un "ingrediente" es en realidad un
plato.

## Por qué

Hallazgos H4 y H8. Ahora `salmorejo` casa con gazpacho con confianza **alta**. Con 500-700 filas
(ticket 03) el algoritmo actual empeora: hay más colisiones de tokens.

## Diseño

### `matchCandidates(name, hints?) → { food, score }[]` (top 5, puro)

`hints` = `{ category?, state? }`, que vienen de la descomposición (ticket 05).

Puntuación, de 0 a 1:

| Señal | Peso |
|---|---|
| Alias o label exacto (también en singular) | 1,0 directo |
| Label contenido entero en el nombre | 0,9 |
| Solape de tokens ponderado por **IDF** (un token raro como "morcilla" pesa más que uno común como "queso") | hasta 0,8 |
| Token cabecera del alimento presente | +0,1 |
| Coincide la categoría del hint | +0,1 |
| Coincide el estado crudo/listo del hint | +0,05 |
| El nombre tiene un **marcador de plato** y el alimento no es ese plato | −0,5 |

**Marcadores de plato:** `crema de`, `tortilla de`, `ensalada de`, `arroz con`, `pure de`,
`salsa de`, `sopa de`, `guiso de`, `bocadillo de`. Si el nombre los lleva y no hay una fila propia
con ese label, el resultado se marca `isDish: true` y el ticket 05 lo descompone como sub-plato en
vez de casarlo con su ingrediente principal.

### `resolveIngredient` v2

- **Aceptar** si `top.score ≥ 0,85` y `top.score − segundo.score ≥ 0,15` → `confidence: "high"`.
- **Ambiguo** si hay candidatos pero no cumple lo anterior → `confidence: "ambiguous"` con los 5
  candidatos. El ticket 05 los desambigua con el modelo.
- **Sin candidatos** → `CATEGORY_FALLBACK[hint.category]` con `confidence: "low"`. Solo sin
  categoría cae en `GENERIC_FOOD`.

### Unidades: `toGrams(qty, unit, food)` (puro)

`g` · `kg` · `ml` (con `densityGPerMl`) · `ud` (con `gPerUnit`) · `cda` = 15 ml · `cdta` = 5 ml ·
`pizca` = 0,5 g · `puñado` = 30 g. Lo usan "comí distinto" y el chat, donde la persona escribe
"2 huevos" o "una cucharada de aceite".

### Registro de lo que no casa

- Migración: tabla `unmatched_ingredients (name_norm text primary key, count int, sample_dish text,
  category text, last_seen timestamptz)`. RLS sin acceso para `authenticated`; solo escribe
  `service_role`.
- Se hace upsert desde el servidor cada vez que un ingrediente cae en `low`.
- Es la lista de trabajo para ampliar `foods.sources.csv`.

## Archivos

- `src/lib/nutrition/nutrition.ts` (casado, `toGrams`)
- `src/lib/nutrition/nutrition.test.ts` (ampliar)
- `supabase/migrations/<fecha>_unmatched_ingredients.sql`

## Criterios de aceptación

- [ ] Fixture de regresión con ≥ 60 nombres, incluidos todos los de H4, → `key` esperada, `isDish`
      o `ambiguous`. Test en verde.
- [ ] Ningún caso de H4 devuelve `high` con el alimento equivocado.
- [ ] `toGrams` con test para cada unidad.
- [ ] El rendimiento del casado sigue por debajo de 1 ms por ingrediente con 700 filas (índice
      invertido de tokens, no un bucle sobre toda la tabla).

## Comments

- 2026-09-24 — Casos para el fixture, sacados de la auditoría (`matchFood` sin modelo):
  `tortilla francesa` → `wrap` (confianza baja) · `granola`, `muesli`, `cereales de desayuno`,
  `bacon`, `panceta`, `sobrasada`, `chistorra`, `fabada`, `cocido`, `paella` → genérico ·
  `leche condensada` → `leche-entera` · `harina de garbanzo` → `garbanzos` (cocidos) ·
  `lomo embuchado` → `cerdo-lomo` · `copos de maíz` → `avena` · `leche de almendras` y
  `bebida de soja` → `bebida-avena` (confianza alta). `tortilla francesa`, `fabada`, `cocido` y
  `paella` deben salir `isDish`. Pasa a la fase 3; el 05 ya no depende de este ticket.

- 2026-09-24 — Con D13: "sin candidatos → `CATEGORY_FALLBACK`" solo si el ingrediente aporta
  < 5 % de las kcal; si pesa más, va a USDA (22). La desambiguación con Flash-Lite ya la adelanta el
  13. La tabla `unmatched_ingredients` la sustituye `foods_extra` con su revisión (22).
