# 04 — Comidas: "merienda" en vez de "snack", y respetar las que se piden

Status: hecho, sin commitear (verificado en navegador con perfil demo)
Incidencia del usuario: ⓸

## Cómo quedó

- `MEAL_SLOT_LABEL.snack` → "Merienda" (web + móvil). Chips del onboarding "Snacks" → "Merienda".
  Copy de pantalla revisado: `plan.tsx` (texto del planificador en solitario), `hogar.tsx`
  ("la merienda siempre es individual"), fallback de `guide.functions.ts`. Los identificadores
  internos y la clave JSON `snacks`/`snack` no se tocan.
- Columna nueva `profiles.meal_slots text[]` + CHECK (`20260907130000_profiles_meal_slots.sql`,
  ya aplicada a la base de datos). **Sin backfill a propósito**: `effectiveMealSlots` interpreta
  el `meals_to_plan` antiguo en cada lectura (`parseMealSlotsLegacy`), así que un perfil viejo
  o editado solo por chat sigue funcionando.
- Único punto de lectura: `effectiveMealSlots` (`plan-shared.ts`, web + móvil) — `meal_slots`
  estructurado manda; si no, texto libre interpretado; si tampoco, las cuatro. Tests en
  `plan-shared.test.ts` (`cleanMealSlots`, `parseMealSlotsLegacy`, `effectiveMealSlots`,
  `mealsForDate` con `selectedSlots`).
- El onboarding guarda `meal_slots` directo de la respuesta cruda a los chips
  (`mealSlotsFromRawAnswer`), sin pasar por `parseOnboarding` (la IA lo volvía frase). Manda
  los dos campos a la vez.
- Editar solo el texto libre (pantalla "Mis respuestas" o coach `actualizar_perfil`) limpia
  `meal_slots` — la regla está centralizada en `saveProfile` (`daily.ts`, web + móvil), no
  repetida en cada llamador.
- Se hace cumplir en tres capas: (1) el prompt de `generateMonthlyPlan` y `adjustMonthlyPlan`
  pide solo los slots elegidos; (2) `blankUnselectedSlots` los vacía por código tras la IA;
  (3) `mealsForDate(plan, date, selectedSlots)` los filtra al pintar en Hoy, Plan y el detalle
  del día (web + móvil). La tercera capa además tapa el caso de una comida espejada del hogar
  que traiga contenido en un slot que esa persona no planifica.

## Verificado (perfil demo, navegador)

- `effectiveMealSlots` con el código real: texto libre "Desayuno, comida y cena" → sin merienda;
  `meal_slots` estructurado gana al texto; perfil vacío → las cuatro.
- `mealsForDate` sobre el plan real del demo: pasar `["comida","cena"]` quita el desayuno
  aunque el día tenga `breakfast`.
- `saveProfile({ meals_to_plan })` a secas deja `meal_slots` en `null`; con los dos campos,
  respeta el `meal_slots` explícito.
- `bun run lint` / `typecheck` / `test` (233) y `tsc` de móvil, verdes.
- Pendiente de una prueba con regeneración de plan real (llamada de pago); las tres capas de
  arriba lo cubren igualmente.

## Objetivo

Que las comidas que la persona elige en el onboarding sean las que aparecen en su plan, y que
el slot se llame como lo llama en casa.

## Contexto

`meals_to_plan` es **texto libre**: se inyecta en el prompt como una frase
(`src/lib/ai-provider.server.ts:134`) y nada lo hace cumplir. Los slots están fijos en
`MEAL_SLOTS = ["desayuno","comida","cena","snack"]` y la rotación semanal siempre emite
`breakfasts[]` y `snacks[]`, así que el snack aparece pida lo que pida. Además "Merienda" no
existe como opción: los chips ofrecen "Snacks".

## Tareas

1. **Renombrar el slot de cara a la persona**: `MEAL_SLOT_LABEL.snack` pasa de "Snack" a
   **"Merienda"** (`src/lib/plan-shared.ts:14`). La clave interna sigue siendo `snack` —
   identificadores en inglés, textos en español. Revisar el resto de copy que diga "snack"
   en las dos apps y en `es.json` / `en.json`.
2. **Estructurar `meals_to_plan`**: dejar de guardar texto libre y guardar el conjunto de
   slots elegidos. Migración para la columna nueva en `profiles` + tolerancia con los
   perfiles antiguos (interpretar el texto existente una vez, sin perder datos).
3. **Chips del onboarding** (`src/routes/_authenticated/onboarding.tsx:208-212`): cambiar
   "Snacks" por "Merienda" y dejar claro que es multiselección.
4. **Hacerlo cumplir de verdad**, que es el fondo del asunto:
   - `generateMonthlyPlan` pide a la IA solo los slots elegidos.
   - Las pantallas Hoy y Plan pintan solo esos slots, en web y en móvil.
   - Repasar que `deriveSharedSlots` y compañía no reintroduzcan un slot descartado.
5. **Móvil**: `mobile/lib/plan-shared.ts:19` y las pantallas correspondientes.

## Verificación

- Perfil demo nuevo eligiendo solo Comida, Merienda y Cena → generar plan → **no aparece
  desayuno** en Hoy ni en Plan, y la merienda se llama merienda.
- Un perfil antiguo con `meals_to_plan` en texto libre sigue funcionando.
- `bun run lint` / `typecheck` / `test` verdes.

## Hecho cuando

Lo elegido en el onboarding se respeta en el plan generado, y la palabra "snack" no aparece en
pantalla.
