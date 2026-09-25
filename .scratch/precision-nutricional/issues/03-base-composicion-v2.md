# 03 — Base de composición v2

Status: ready (D5 aprobada: USDA FoodData Central + CIQUAL; BEDCA solo como contraste, sin copiar valores)
Blocked by: 02
Tamaño: L
Fase: 3

## Qué

Rehacer `foods.data.ts` como un archivo **generado** a partir de una fuente de referencia
trazable. Todo en crudo y porción comestible, con medidas caseras, ~500-700 filas y tests de
integridad.

## Por qué

Hallazgos H3 (crudo y cocinado mezclados), H4 (alias peligrosos), H7 (sin medias por categoría ni
unidades) y H12 (167 filas). La tabla es el techo de precisión de todo lo demás: si un valor está
mal, ningún escalado lo arregla.

## Diseño

### Fuente y generación

- `src/lib/nutrition/foods.sources.csv`, mantenido a mano: `key, label, aliases, category, source,
  sourceId, state, gPerUnit, unitLabel, yieldBoiled, yieldGrilled, yieldBaked, yieldFried,
  fatAbsorbedFried, pricePer100Eur, shelfLifeDays`.
- `scripts/build-foods.ts`: lee los CSV descargados de USDA FoodData Central (SR Legacy +
  Foundation) y CIQUAL, cruza por `sourceId` y escribe `foods.data.ts` con la cabecera
  `// GENERADO por scripts/build-foods.ts — no editar a mano`.
- **Los valores nutricionales nunca se escriben a mano.** A mano solo van alias, medidas caseras,
  precio y vida útil. Si un producto no está en ninguna fuente (salmorejo), se usa `source: "receta"`
  y se calcula como suma de sus ingredientes con la receta en el propio CSV.
- Un modelo caro **offline** puede proponer alias en español (lo permite la memoria
  `ai-plan-quality-cheap-model`), pero una persona los revisa.

### Campos nuevos en `Food`

| Campo | Para qué |
|---|---|
| `state: "crudo" \| "listo"` | Crudo = se pesa antes de cocinar. Listo = se come tal cual se compra (bote, pan, embutido, lácteo). |
| `yieldByMethod` | Peso cocinado ÷ peso crudo (hervido, plancha, horno, frito). Solo sirve para **mostrar** el peso cocinado y para convertir si alguien da el peso cocinado. Las macros no lo necesitan. |
| `fatAbsorbedPer100g` (frito) | Aceite que absorbe el alimento al freírlo. |
| `gPerUnit`, `unitLabel` | Huevo 55 g, diente de ajo 4 g, lata de atún escurrida 56 g, yogur 125 g, rebanada de pan 30 g, cucharada de aceite 10 g. |
| `source`, `sourceId` | Trazabilidad de cada fila. |
| `sugars_g?`, `satfat_g?`, `salt_g?` | Reservados; fuera de alcance por ahora. |

### Cobertura mínima que falta hoy

- **Bebidas:** cerveza, vino, refresco normal y zero, zumo, bebidas vegetales **por separado**
  (soja ≠ almendra ≠ avena), café con leche.
- **Embutidos por separado:** chorizo, morcilla, salchicha fresca, fuet, salchichón, lomo
  embuchado, bacon, pavo loncheado, jamón cocido.
- **Quesos por separado:** los que el plan usa de verdad (el golden set del ticket 02 lo dice).
- **Pares crudo/listo:** arroz, pasta, quinoa, cuscús, legumbre seca y de bote, patata.
- **Preparaciones base:** sofrito, bechamel, mayonesa, alioli, vinagreta, masa de pizza, hojaldre.
- **Platos-producto comunes:** salmorejo, gazpacho, tortilla de patatas, hummus, croquetas,
  pizza, pan de pita, fideos de arroz, noodles.
- **Congelados** (mismos valores que el fresco, alias propios) y conservas en aceite frente a
  natural.

### Política de alias

Un alias solo se admite si el alimento es **nutricionalmente equivalente (±15 % kcal)**. Un plato
compuesto ("crema de calabacín", "tortilla de patatas", "arroz con leche") **nunca** es alias de su
ingrediente principal: o tiene fila propia, o el ticket 04 lo trata como plato.

### Medias por categoría

`CATEGORY_FALLBACK`: **mediana** por categoría (robusta a extremos como el aceite dentro de
"grasa"), calculada al cargar el módulo. Sustituye a `GENERIC_FOOD` como respaldo cuando se conoce
la categoría. `GENERIC_FOOD` queda solo para "no sé ni la categoría".

## Tests de integridad (`foods.integrity.test.ts`, entran en `bun run test`)

- Atwater: `kcal ≈ 4·P + 4·(C − fibra) + 2·fibra + 9·G (+ 7·alcohol)` con tolerancia del 12 %
  (hay excepciones documentadas: cacao, alcohol).
- `P + C + G + fibra ≤ 100` g por 100 g.
- `key` única; ningún alias repetido entre dos filas; todos los alias normalizados con `normName`
  (el alias `"mató"` actual falla).
- Coherencia de pares: `arroz crudo ≈ arroz cocido × yieldBoiled` (±10 %).
- Fixture de regresión con los casos de H4 → fila esperada.

## Migración

- Mantener las `key` actuales cuando el alimento es el mismo. Si una fila cambia de estado
  (`pechuga-pollo` pasa de asada a cruda), sube `PIPELINE_VERSION` (ticket 06) para que las recetas
  guardadas se recalculen.
- `foods.data.ts` sigue fuera del bundle del navegador: comprobar con
  `grep -r "pechuga de pollo" .output/public` tras `bun run build`.

## Criterios de aceptación

- [ ] ≥ 500 filas, todas con `source` y `sourceId` (o `source: "receta"` con su receta).
- [ ] Tests de integridad en verde.
- [ ] `bun run eval:recipes`, capa externa: error medio de kcal/100 g ≤ 8 %.
- [ ] `perishability.ts` lee `shelfLifeDays` de `foods` donde encaje (una sola fuente, como pedía
      el spec anterior), sin romper `perishability.test.ts`.

## Comments

- 2026-09-24 — Replanificación: pasa a la fase 3. Lo urgente de la tabla (filas que faltan, alias,
  `wrap`/tortilla, salmón y filas con `cookedYield`, calidad por kcal) se adelanta al ticket 14. La
  duda crudo/cocinado queda resuelta a favor del invariante 3 (D8): gramos crudos en la receta
  canónica; el 05 añade las filas crudas de los básicos y este ticket lo hace sistemático.

- 2026-09-24 — Con D13, `CATEGORY_FALLBACK` solo vale para ingredientes que aportan < 5 % de las
  kcal del plato. Uno que pesa más se resuelve con el alimento más parecido (13) o con USDA (22),
  nunca con una mediana de categoría.
