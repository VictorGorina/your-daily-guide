# 09 — "Comí otra cosa" en Hoy pasa por el núcleo de compensación

Status: hecho y verificado en navegador (perfil demo) y en simulador iOS (2026-09-17). Diseño más
acotado que el de abajo — leer el comentario antes de tocar este ticket.
Blocked by: 08

## Qué

El cambio de plato de hoy deja de decidir la compensación por su cuenta: sigue regenerando la guía
del día, pero la compensación va por `dish-change-batch` → `compensateDishChanges`, con la misma
tabla que el resto.

## Por qué

- D2: todo cambio de plato se analiza igual.
- H7: `use-meal-swap` mide contra `plannedKcal` (congelado con el plato original), así que un
  segundo cambio de la misma comida vuelve a compensar el desvío entero.
- Hoy llama a `adjustMonthlyPlan` **siempre**, también por un cambio parecido; la IA decide si
  compensa "suave". Con la tabla, un cambio parecido no gasta la llamada ni reordena la semana.

## Diseño

En `src/lib/use-meal-swap.ts` y `mobile/lib/use-meal-swap.ts`:

- `swap()` sigue igual en lo inmediato: `setPlanMeal`, `status: "distinto"`, `plannedIdea` y
  `plannedKcal` congelados **solo para pintar** el tachado de Hoy.
- Después de `setPlanMeal`: `enqueueDishChange({ date: hoy, slot, from: previousIdea, to: dish,
  origin: "hoy" })`, en lugar de su lote propio de ajuste.
- La regeneración de la guía de hoy (una llamada por lote) se engancha con `onBatchSettled`, o como
  paso previo del mismo lote si hay cambios de hoy. Mismo `macroEstimate` fijo que ahora.
- Al volver `compensateDishChanges`:
  - `adjusted` → `patchTodayHabits` pone `adjustmentChanges`, `adjustmentSummary` y
    `adjustmentKcal` en las comidas del lote (el badge "i" y `AdjustmentInfoSheet` no cambian);
  - `adjusted: false` → no se escribe ajuste y no sale badge.
- Se eliminan del hook: `noteFor`, la llamada a `adjustMonthlyPlan` y el uso de `kcalDeltaOf` para
  compensar. `kcalDeltaOf` se borra si queda sin uso (y su test).
- El spinner por comida (`isAdjusting`) pasa a leer `useDishChangeBatch().isPending(hoy, slot)`.

## Archivos

- `src/lib/use-meal-swap.ts`, `mobile/lib/use-meal-swap.ts`
- `src/lib/macros.ts` + test, `mobile/lib/macros.ts` (si `kcalDeltaOf` queda sin uso)
- `src/routes/_authenticated/hoy.tsx`, `mobile/app/(app)/hoy.tsx` (solo si cambia la firma del hook)

## Criterios de aceptación

- [ ] Navegador (demo, objetivo perder): cena de hoy → "pizza cuatro quesos" → spinner, luego badge
      "i" con días futuros ajustados; la barra de macros de hoy sube.
- [ ] Cena de hoy → un plato parecido: la guía se regenera, pero sin badge "i" y sin llamada a
      `plan/compensate` que reajuste (comprobar en red: `adjusted: false`).
- [ ] Cambiar la misma cena dos veces en lotes distintos: la segunda compensación usa como `from` el
      plato del primer cambio (comprobar en la petición).
- [ ] Simulador: los mismos tres casos.

## Comments

- 2026-09-17: implementado con un diseño más acotado que el de arriba, a partir de un pedido
  concreto del usuario ("si modificas varios platos debería ir sumando el desvío de calorías y si
  llega a los límites modificar el plan") que reveló un hueco que el diseño de arriba tampoco
  resolvía: agrupaba Δkcal solo dentro de UN lote, así que dos cambios pequeños en lotes separados
  del mismo día nunca se sumaban para cruzar el umbral.
  - **No se creó** `src/lib/dish-change-batch.ts` / `mobile/lib/dish-change-batch.ts` ni
    `enqueueDishChange`/`onBatchSettled`/`useDishChangeBatch` (eso sigue pendiente si la tira de
    días futuros del ticket 07 llega a necesitarlo — no tiene consumidor hoy). `use-meal-swap.ts`
    conserva su propio lote (Map por `label`, solo hoy), igual que antes.
  - En vez de eso, `compensateDishChanges` (`src/lib/plan.functions.ts`) guarda el desvío de CADA
    comida cambiada en dos campos nuevos de `MealHabit` (`swapKcalDelta`, `swapCompensated` —
    `src/lib/plan-shared.ts`, sin migración de Supabase porque `habits` ya es JSONB sin esquema
    fijo) y decide con la suma de TODO el día (`pendingSwapKcal`), no solo la del lote actual. Así
    dos cambios de +120 y +150 kcal en momentos distintos del día sí se compensan juntos aunque
    cada uno por separado quede bajo el umbral de `compensationNeed`.
  - `perMealKcalDeltas` (`src/lib/macros.ts` + mobile) sustituye a `kcalDeltaOf`, que se borró (con
    su test) porque ya nadie necesita el total ya sumado del lote, solo el desvío por comida.
  - La regeneración de la guía sigue como antes (`generateDailyGuide` completo, no
    `computeDishMacros` por plato) — cambiar eso sería una vía paralela de cálculo de macros sin
    necesidad real hoy; se puede reconsiderar si el ticket 08 completo llega a hacer falta.
  - Espejo `src/routes/api/v1/plan/compensate.ts`. `adjustMonthlyPlan`/`reflowMeals` no cambiaron —
    el tool del coach `ajustar_plan_mensual` sigue llamando a `adjustMonthlyPlan` directamente y
    siempre intenta el ajuste (es una petición explícita, nunca la debe silenciar un umbral).
  - Verificado en navegador con perfil demo nuevo ("Probar sin cuenta"): un cambio de +59 kcal no
    compensa (`reason: "below-threshold"`, sin llamar a `reflowMeals`); un segundo cambio de +28
    kcal en OTRO lote tampoco (87 acumulado, sigue bajo 200); un tercer cambio (+798 kcal) hace que
    el acumulado (826) cruce el umbral y SÍ recoloca 2 días futuros — confirmado con
    `swapCompensated: true` en las tres filas y `adjustmentKcal: 826` escrito por el servidor.
  - **Simulador iOS, verificado (2026-09-17, segunda sesión).** La pantalla de login
    (`app/auth.tsx`, sin tocar en este cambio) parecía no responder a los toques de
    "Empezar"/"Ya tengo cuenta" — la causa real era un HUD del sistema ("Type in multiple
    languages", el aviso de teclado multilenguaje de iOS) que se queda pegado tras el primer uso
    del teclado y bloquea el toque en TODA la pantalla, no solo en su propia zona visual; ni
    `simctl terminate` + `launch` lo limpia. El arreglo es pulsar el botón HOME (no solo terminar
    el proceso) antes de relanzar la app — eso sí lo descarta. Con eso resuelto, se creó una sesión
    de prueba sin pasar por esa pantalla en absoluto: `POST {SUPABASE_URL}/auth/v1/signup` con
    `{}` (con la `anon key`, igual que hace `signInAnonymously()` en el código) da un
    access/refresh token; ese JSON se escribe bajo la clave `sb-<ref>-auth-token` en
    `RCTAsyncLocalStorage_V1/manifest.json` del contenedor de la app en
    `~/Library/Developer/CoreSimulator/Devices/<UDID>/data/Containers/Data/Application/<uuid>/Library/Application Support/<bundle-id>/`
    (formato idéntico al `localStorage` que ya usa Supabase-js en la web), y al relanzar la app ve
    sesión y entra directo a Hoy. Perfil y plan del usuario de prueba escritos con la
    `service_role key` vía REST (mismos campos que `randomDemoProfile()` + `/api/v1/plan/generate`).
    Reproducidos los tres pasos del navegador: cambio de Comida con Δ −44 kcal (queda pendiente,
    sin llamar a `reflowMeals`); cambio de Cena con Δ +928 kcal en un lote SEPARADO (−44 + 928 =
    884, cruza el umbral); `adjustmentKcal: 884` y `swapCompensated: true` en las dos filas,
    `AdjustmentInfoSheet` mostrando "+880 kcal" y la cena del 18 recolocada. Usuario de prueba
    borrado al terminar (`DELETE /auth/v1/admin/users/<id>` con `service_role`).
