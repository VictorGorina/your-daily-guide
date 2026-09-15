# 06 — Recetas canónicas: caché global en Supabase

Status: ready
Blocked by: 05
Tamaño: M

## Qué

Guardar cada receta canónica **una sola vez para todo el mundo** en la tabla `dish_recipes`, y que
Hoy (y después todo lo demás) lea de ahí.

## Por qué

Hallazgo H6. Es lo que garantiza "mismo plato → mismas cifras" y lo que hace asequible el pipeline
del ticket 05 (3 muestras + validación) con un modelo barato: se paga una vez por plato, no una vez
por persona y día.

## Diseño

### Tabla

```sql
create table dish_recipes (
  dish_key          text primary key,
  dish_label        text not null,
  ingredients       jsonb not null,      -- [{foodKey, name, gramsRaw, method, confidence}]
  quality           numeric not null,
  agreement         numeric not null,    -- acuerdo entre lecturas (ticket 05)
  judged            boolean not null default false,
  sources           text[] not null default '{}',  -- URLs de recetas publicadas (Sonar)
  flags             text[] not null default '{}',
  pipeline_version  int not null,
  foods_version     text not null,
  reviewed          boolean not null default false,
  hits              int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table dish_recipes enable row level security;
create policy "dish_recipes_read" on dish_recipes for select to authenticated using (true);
-- sin políticas de insert/update: solo service_role escribe
```

- **Las macros no se guardan.** Se calculan al leer con `macrosOfRecipe(recipe)` contra `foods`. Si
  se corrige un valor de la tabla, se corrigen todos los platos sin migrar.
- `hits` se incrementa con una RPC `security definer`, sin esperar la respuesta. Sirve para
  priorizar la revisión manual.

### `dishKey(label)` (puro)

`normName` → tokens significativos → singular → **ordenados**. Así "arroz con pollo" y "pollo con
arroz" comparten receta, y "Lentejas estofadas con verdura" y "…con verduras" también. Test con
pares que deben coincidir y pares que no ("tortilla de patatas" ≠ "patatas con tortilla" no es un
riesgo real; "pollo al curry" ≠ "curry de garbanzos" sí debe diferir).

### `getRecipes(dishes[]) → Map<label, CanonicalRecipe>` (`recipes.server.ts`)

1. Lee todas las `dish_key` de golpe (`in (...)`).
2. Descarta las que tienen `pipeline_version` antigua y **no** están `reviewed`.
3. Lo que falte → pipeline del ticket 05 → `upsert … on conflict do nothing` con `supabaseAdmin`.
   Si dos personas piden el mismo plato a la vez, gana la primera y la otra lee la suya igual de
   válida.
4. Si el pipeline falla, devuelve `null` para ese plato y el llamador usa `roughMealMacros`, como
   ahora.

### Quién lo usa en este ticket

- `generateDailyGuide` → `macrosFromLookup` usa `getRecipes` con la ración base (el escalado llega en
  el ticket 08).
- Se elimina el memo por proceso de `resolve-dish.server.ts`.

### Precalentamiento

Al guardar un plan (`generateMonthlyPlan`, `reflowMonthlyPlan`, `setPlanMeal`), descomponer los
platos únicos de los **próximos 7 días** con un presupuesto de tiempo de ~8 s. El resto se calcula
cuando se lea. Nada queda corriendo después de responder: en serverless no está garantizado.

### Revisión manual

`bun run recipes:review`: lista las recetas con más `hits` que tengan `quality < 0,95`,
`agreement < 0,8`, `judged = true` o algún flag (sobre todo `una_fuente`), con sus ingredientes y
las URLs de `sources`, para revisarlas a mano y marcar `reviewed = true`. Objetivo: las 100 recetas
con más `hits` revisadas en el primer mes. Una receta revisada no se
vuelve a descomponer aunque cambie `PIPELINE_VERSION`.

## Archivos

- `supabase/migrations/<fecha>_dish_recipes.sql`
- `src/lib/nutrition/recipes.server.ts` (nuevo), `dish-key.ts` + test (puro)
- `src/lib/guide.functions.ts`
- `src/lib/plan.functions.ts` (precalentamiento)
- `scripts/recipes-review.ts`, `package.json`

## Criterios de aceptación

- [ ] El mismo plato para dos personas y en dos días → macros idénticas.
- [ ] Una sesión `authenticated` no puede insertar ni actualizar en `dish_recipes` (probar con la
      anon key y un JWT del perfil demo).
- [ ] La guía diaria con todos los platos en caché no hace **ninguna** llamada de descomposición.
- [ ] `bun run eval:recipes` repetido dos veces da el mismo resultado (determinismo 100 %).
- [ ] CLAUDE.md y AGENTS.md actualizados: receta canónica, caché global, macros al leer.
- [ ] Móvil sin cambios: `/api/v1/guide` devuelve la misma forma. Comprobar Hoy en el simulador.

## Comments
