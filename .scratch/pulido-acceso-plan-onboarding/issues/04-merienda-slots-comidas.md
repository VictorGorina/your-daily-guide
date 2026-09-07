# 04 — Comidas: "merienda" en vez de "snack", y respetar las que se piden

Status: sin empezar
Incidencia del usuario: ⓸

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
