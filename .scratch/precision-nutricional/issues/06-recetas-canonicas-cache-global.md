# 06 — Recetas canónicas: caché global en Supabase

Status: implementado (2026-09-25, sin desplegar); falta aplicar la migración
Blocked by: 05
Tamaño: M
Fase: 2

## Qué

Guardar cada receta canónica **una sola vez para todo el mundo** en la tabla `dish_recipes`, y que
Hoy (y después todo lo demás) lea de ahí.

## Por qué

Hallazgo H6. Es lo que garantiza "mismo plato → mismas cifras" y lo que hace asequible el pipeline
del ticket 05 (lectura estructurada + validación; y las fuentes del 20 si hacen falta): se paga una vez por plato, no una vez
por persona y día.

## Diseño

### Tabla

```sql
create table dish_recipes (
  dish_key          text primary key,
  dish_label        text not null,
  ingredients       jsonb not null,      -- [{foodKey, name, gramsRaw, state, confidence}]
  method            text not null,       -- enum de cocción del ticket 14 (decide el aceite)
  serving_kind      text not null default 'plato',  -- 'plato' | 'unidad' (ticket 17)
  unit_label        text,                -- "pizza individual"
  quality           numeric not null,
  agreement         numeric,             -- acuerdo entre lecturas (ticket 20; null con una lectura)
  judged            boolean not null default false,  -- ticket 20
  sources           text[] not null default '{}',  -- URLs de recetas publicadas (Sonar, ticket 20)
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
4. Si el pipeline falla (tras toda la cadena del 13), devuelve `null` para ese plato. El llamador lo
   enseña como "Calculando…" y lo reintenta. Nunca un promedio (D13).

### Quién lo usa en este ticket

- `generateDailyGuide` → `macrosFromLookup` usa `getRecipes` con la ración personal (21; el escalado
  fino llega en el 08).
- Se elimina el memo por proceso de `resolve-dish.server.ts`.

### Precalentamiento

**Todos los platos del plan se calculan al generarlo** (D13). Ningún plato planificado llega a Hoy
sin su receta.

- Al guardar un plan (`generateMonthlyPlan`, `reflowMonthlyPlan`), el cliente pide en trozos
  (`POST /api/v1/recipes/warm`, ~8 platos por llamada, varias en paralelo) los platos únicos del mes
  que falten en la caché. La pantalla lo enseña: "Calculando tus platos 24/48".
- Nada queda corriendo en el servidor después de responder (serverless). Si la app se cierra antes,
  la pantalla Plan lo retoma al abrirse, con el mismo patrón que `flushPlanRecalc`.
- Un plato del plan que no se puede calcular tras toda la cadena del 13 (no por una caída, sino
  porque no se deja descomponer) se sustituye con **una** llamada con la forma `cambios` y se vuelve
  a calcular.
- `setPlanMeal` (plato escrito por la persona) calcula el suyo al guardarlo. Si el texto es vago, se
  pregunta (13).

### Revisión manual

`bun run recipes:review`: lista las recetas con más `hits` que tengan `quality < 0,95` o algún flag
de `validateRecipe` (`fuera_de_banda`, recortes, inventados) y, si existe el ticket 20,
`agreement < 0,8` o `judged = true`. Enseña sus ingredientes (y las URLs de `sources`) para
revisarlas a mano y marcar `reviewed = true`. Mientras no haya fuentes independientes, esta
revisión es la segunda opinión de las recetas más usadas. Objetivo: las 100 recetas
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
- [ ] Tras generar un plan, todos sus platos están en la caché. Si la app se cierra a medias, se
      retoma al reabrir Plan (test del reintento).
- [ ] Una sesión `authenticated` no puede insertar ni actualizar en `dish_recipes` (probar con la
      anon key y un JWT del perfil demo).
- [ ] La guía diaria con todos los platos en caché no hace **ninguna** llamada de descomposición.
- [ ] `bun run eval:recipes` repetido dos veces da el mismo resultado (determinismo 100 %).
- [ ] CLAUDE.md y AGENTS.md actualizados: receta canónica, caché global, macros al leer.
- [ ] Móvil sin cambios: `/api/v1/guide` devuelve la misma forma. Comprobar Hoy en el simulador.

## Comments

- 2026-09-24 — Replanificación: pasa a la fase 2, detrás del 05 de una sola lectura. Las columnas
  `agreement`, `judged` y `sources` quedan reservadas para el ticket 20 (fuentes independientes, solo
  si el eval lo pide). La receta guarda también `method`, `servingKind` y `unitLabel` (05), que usan
  el 14 (aceite) y el 17 (unidad natural). Con la caché, el 18 mide lo que absorbe el reajuste actual.

- 2026-09-24 — Tras confirmar D7-D13: D13: todos los platos del plan se calculan al generarlo (antes, solo los próximos 7 días).

- 2026-09-25 — **Implementado**: migración `20260925140000_dish_recipes.sql` (+ `text_quantity`,
  para que "media pizza" guarde su cantidad), `dishKey` + test, `getRecipes` (tolera la tabla sin
  crear: caché por proceso), guía, compensación de cambios futuros y picoteo sobre la caché,
  precalentamiento en la pantalla Plan (web y móvil, `/api/v1/recipes/warm`, bucket `recipe-warm`),
  `bun run recipes:review`. Pendiente: aplicar la migración (SQL Editor) y la prueba de RLS con un
  JWT del perfil demo; sustituir un plato del plan que no se deja calcular (hoy queda
  "calculando" y se reintenta).
