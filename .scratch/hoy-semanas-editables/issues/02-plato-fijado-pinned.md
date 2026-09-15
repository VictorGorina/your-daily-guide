# 02 — Plato elegido a mano protegido (`PlanDay.pinned`)

Status: resolved
Blocked by: —
Tamaño: S

## Qué

Marcar en el plan qué comidas de un día se eligieron a mano y hacer que ninguna recolocación
automática las pise.

## Por qué

Hallazgo H3 del spec. `setPlanMeal` escribe `lunch`/`dinner` igual que lo haría la IA, y
`applyPlanChanges` ([plan-shared.ts:1363](../../../src/lib/plan-shared.ts)) y `mergeFuturePlan`
([plan-shared.ts:1286-1290](../../../src/lib/plan-shared.ts)) los sobrescriben. Hoy solo sobreviven
desayuno y merienda, porque la IA no los devuelve. Consecuencia: cambias la cena del jueves (desde el
coach, y con el ticket 07 desde la tira) y un reajuste posterior (un cambio de hoy, la despensa, la
mesa del hogar) te la devuelve a otra cosa. La compensación del ticket 08 lo haría pasar siempre.

## Diseño

- `PlanDay.pinned?: MealSlot[]`: slots elegidos a mano ese día. Es un campo JSON del plan, **sin
  migración**. Tipos en `src/lib/plan-shared.ts` y `mobile/lib/plan-shared.ts`.
- `cleanPlan` lo conserva (filtra slots válidos, sin duplicados, y lo omite si queda vacío).
- `withPlanMeal(..., { pin })`: `pin: true` añade el slot; `pin: false` lo quita.
- `setPlanMeal`:
  - input `pin?: boolean` (por defecto `true`);
  - respuesta añade `previousPinned: boolean`, para que "Deshacer" (ticket 07) restaure el estado
    exacto.
- `applyPlanChanges`: no cambia `lunch`/`dinner` si el slot está en `pinned`.
- `mergeFuturePlan`: igual.
- `reflowMeals`: en el JSON `dated` cada día lleva `"fijo": ["cena"]` si aplica, y una regla nueva
  en el prompt ("no cambies los platos marcados como fijo"). `applyPlanChanges` es el cinturón.
- `syncSharedMeals` / composición del hogar: sin cambios de comportamiento, pero con test de que el
  espejo no pierde ni inventa `pinned`.

## Archivos

- `src/lib/plan-shared.ts` + `src/lib/plan-shared.test.ts`, `mobile/lib/plan-shared.ts`
- `src/lib/plan.functions.ts` (`setPlanMeal`, `reflowMeals`)
- `src/routes/api/v1/plan/meal.ts` (pasa `pin`; sin lógica nueva)

## Criterios de aceptación

- [x] Tests: `applyPlanChanges` y `mergeFuturePlan` no pisan una cena `pinned` y sí cambian la comida
      no fijada del mismo día.
- [x] Test: `cleanPlan` conserva `pinned` válido y descarta basura.
- [x] Test: `withPlanMeal` con `pin: false` quita el slot y deja el campo fuera si queda vacío.
- [x] Navegador (perfil demo): comprobado por la misma ruta HTTP que usan el coach y Hoy (ver
      Comments).
- [x] CLAUDE.md: corregido el párrafo "Un cambio a mano…" para que diga `pinned`.

## Comments

- 2026-09-15 — Hecho. `PlanDay.pinned` + `isPinned` + `mirrorPinned` en `src/lib/plan-shared.ts`;
  `cleanDay` lo sanea; `applyPlanChanges` y `mergeFuturePlan` no pisan comidas fijadas;
  `reflowMeals` las manda al modelo como `"fijo"` con una regla en el prompt; `setPlanMeal` acepta
  `pin` y devuelve `previousPinned`; `composeDayForUser` y `syncSharedMeals` espejan la marca como
  el plato de un niño. Tipos, `isPinned`, `withPlanMeal` y el espejo en `composeDayForUser`, también
  en `mobile/lib/plan-shared.ts`. Revisados el resto de escritores del plan: todos hacen spread del
  día, ninguno pierde `pinned`. Sin migración.
- Tests: 10 nuevos en `plan-shared.test.ts`. Prueba de mutación: con `isPinned` desactivado fallan
  justo los dos tests de protección; restaurado, 139/139.
- Prueba de extremo a extremo (perfil demo anónimo, `localhost:8080`):
  1. `POST /api/v1/plan/meal` cena del 17-sep → "Hamburguesa doble con patatas fritas":
     `pinned: ["cena"]`, `previousPinned: false`. Leído de la BD con `bun run db`: la única celda con
     `pinned` es esa.
  2. `POST /api/v1/plan/adjust` con `kcalDelta: 900` y nota pidiendo aligerar las cenas del 16, 17 y
     18 → cambiaron el 16 ("Sopa de puerro y zanahoria con huevo cocido" → "Sopa de puerro y
     zanahoria") y el 18 ("Pedir fuera" → "Merluza al horno con patata y pimiento"); el 17 siguió
     siendo la hamburguesa.
  3. "Deshacer" (`pin: false` con `previousIdea`) → `previousPinned: true`, sin `pinned`, sin
     `extras`, vuelve la tortilla. Sin errores en el log del servidor.
  Las cenas del 16 y 18 del perfil demo quedan con el reajuste de la prueba (perfil desechable).
- Caso límite anotado (no cambiado): un plato fijado sobrevive también a la regeneración por cambio
  del hogar (`scope: "full"`), igual que ya pasaba con un desayuno o merienda puestos a mano. Si se
  añade una alergia, un plato fijado que la contenga no se sustituye solo. Candidato a aviso en
  pantalla en un ticket aparte.
- Hallazgo fuera de alcance: `syncSharedMeals` decide qué días copiar por posición en la fila, no
  por fecha (el fallo que ya se corrigió en `mergeFuturePlan`). Propuesto como tarea aparte.
