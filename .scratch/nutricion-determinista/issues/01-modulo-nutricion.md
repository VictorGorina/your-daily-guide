# 01 — Módulo `src/lib/nutrition/`

Status: done (2026-09-10)

## Qué

Crear el módulo que convierte un string de plato en macros/precio deterministas.

### `foods.data.ts`
Tabla de ~200-300 alimentos de dieta mediterránea. Tipo:

```ts
type Food = {
  key: string;                // slug canónico, "pechuga-pollo"
  label: string;              // "pechuga de pollo"
  aliases: string[];          // normalizados (sin acentos, minúscula)
  category: "proteina" | "verdura" | "fruta" | "cereal" | "legumbre"
          | "lacteo" | "grasa" | "fruto-seco" | "despensa" | "otros";
  kcal: number;               // por 100 g, porción comestible tal como se come
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  densityGPerMl?: number;     // para ingredientes que el modelo dé en ml
  perishable: boolean;
  shelfLifeDays: number;      // Infinity para despensa/congelado/conserva
  pricePer100Eur: number;     // súper ES, aproximado, mantenido a mano
};
```

Reglas de datos:
- Arroz/pasta/legumbre: fila principal = **cocido/tal como se sirve** (`arroz` ≈ 130 kcal),
  entradas aparte para crudo (`arroz crudo` ≈ 360) con sus aliases.
- Valores redondeados a entero; son orientativos.

### `nutrition.ts` (puro)
- `matchFood(name: string): { food: Food; confidence: "high" | "low" } | null`
  normaliza → alias exacto → solape de tokens (≥1 token significativo) → media de la
  categoría si el nombre trae una pista de categoría → `null`.
- `macrosOf(ingredients: ResolvedIngredient[]): MacroEstimate` — Σ (por-100 × gramos / 100).
- `priceOf(ingredients): number` — Σ (`pricePer100Eur` × gramos / 100).
- `ResolvedIngredient = { name: string; grams: number; food: Food | null; confidence }`.

### `resolve-dish.server.ts`
- `dishToIngredients(opts: { dish; servings; locale?; key; cache? })`
  → `{ ingredients: ResolvedIngredient[]; source: "cache" | "model" | "unresolved" }`.
- Prompt: descompón el plato en ingredientes con gramos **para `servings` raciones**,
  usando estas `key` cuando encajen: `[lista]`. Anclas de ración ("un plato de pasta ≈ 70 g
  en seco / 180 g cocida", etc.).
- Salida por schema Zod: `{ ingredients: [{ key: string | null, name: string, grams: number }] }`.
- Cache: `hash(normalize(dish) + servings + locale)` → tabla `dish_breakdowns`
  (`hash pk, dish, servings, ingredients jsonb, created_at`). Se lee antes de llamar al
  modelo y se escribe después.

### `nutrition.test.ts`
- `matchFood`: alias exacto, acento/plural, solape ("pechuga pollo a la plancha" → pollo),
  media de categoría, `null`.
- `macrosOf` / `priceOf`: caso conocido con números a mano.
- Sin tests del modelo (no hay red en la suite).

## Hecho cuando
`bun run test` verde con los tests nuevos, `bun run typecheck` y `bun run lint` limpios.
