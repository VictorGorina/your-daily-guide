# 06 — Estado de compra y despensa compartidos

Status: resolved
Blocked by: 05

## Objetivo

Cualquier miembro de la familia con cuenta puede marcar "lo tengo en casa" / "comprado en el
súper", el gasto real y la despensa extra sobre la lista del hogar. No puede tocar platos,
cantidades ni cadencia.

## Tareas

1. Helper `resolveShoppingRow(supabase, userId, month)` (reutiliza `resolveHouseholdPlan` de 05) → fila objetivo = fila del planificador si el que llama está en un hogar, si no la
   propia; más `isMine`.
2. En `src/lib/plan.functions.ts`, cambiar a este resolver la fila objetivo de:
   `toggleShoppingOwned`, `setTripActual`, `setTripConfirmed`, `scanTripReceipt`,
   `setPantryExtra`.
   - `isMine` → escritura normal (`.eq("user_id", context.userId)`, como ahora).
   - `!isMine` → verificar membresía del hogar (`householdContext`) y escribir con
     `supabaseAdmin` **solo** la columna de estado correspondiente
     (`shopping` con únicamente `owned`/`ownedTrips` cambiados, `trip_actuals`,
     `trip_receipts`, `confirmed_trips`, `pantry_extras`). Nunca `plan` ni `weekQty`.
   - `scanTripReceipt`: la foto sigue sin guardarse; el `pantry_extras` resultante va a la
     fila del planificador.
3. `confirmed_at`: `setTripConfirmed` marca el mes como cerrado en la fila del planificador
   cuando todos los tramos están fijados — `syncSharedMeals` ya respeta `confirmed_at` para
   no tocar un mes cerrado.
4. Rutas `/api/v1/*`: ya existen (`plan/shopping-owned`, `plan/trip-actual`,
   `plan/trip-confirm`, `plan/receipt`, `plan/pantry-extra`); no hace falta añadir, solo
   confirmar que siguen pasando por la misma server fn.
5. UI (web + móvil): la pestaña Ingredientes de un no planificador deja de ser solo lectura
   para los chips Falta/Tengo/Comprado y el escaneo de tiquet; el resto (regenerar,
   cambiar cadencia) sigue oculto para no planificadores.

## Verificación

Dos perfiles demo en el mismo hogar: el no planificador marca 3 ingredientes como "en casa"
y sube una foto de tiquet → el planificador ve esas marcas y el gasto real reflejados.
Comprobar que el no planificador NO puede regenerar ni cambiar cadencia. Simulador igual.

## Hecho cuando

Estado de compra y despensa editables por cualquier miembro con cuenta; platos y cantidades
intocables para no planificadores; lint/typecheck verdes; replicado en móvil.

## Answer

Hecho (2026-09-01), web + móvil.

**Servidor** ([src/lib/plan.functions.ts](../../../src/lib/plan.functions.ts)): tres helpers
nuevos — `resolveShoppingRow(supabase, userId)` (fila objetivo = la del planificador si el
que llama es miembro no planificador, si no la propia; membresía verificada por
`householdContext`, que solo devuelve `plannerId` si eres del mismo hogar),
`readShoppingRow` y `writeShoppingState` (fila propia → cliente de sesión; fila del
planificador → `supabaseAdmin`, porque la policy RLS de issue 05 solo deja LEERla). Las
cinco server fns (`toggleShoppingOwned`, `setTripActual`, `setPantryExtra`,
`scanTripReceipt`, `setTripConfirmed`) pasan por ellos. El `patch` de escritura nunca
contiene `plan` ni `weekQty`. `scanTripReceipt` lee el perfil de quien llama pero la fila
de compra y el `pantry_extras` resultante van a la del planificador. Rutas `/api/v1/*` sin
cambios (ya invocaban las mismas fns).

**UI** (`src/routes/_authenticated/plan.tsx` + `mobile/app/(app)/plan.tsx`): se borró el
`HouseholdShoppingBlock` de solo lectura. Ahora un no planificador ve "La compra de la
casa" como un `IngredientsTab` completo (`plannerLocked`) — navegador de tramos, chips
Falta/Tengo/Comprado, despensa, gasto real y tiquet, y modo compra a pantalla completa
(`shopSource: "own" | "household"`) para ir al súper de forma autónoma. Solo se ocultan
regenerar y la cadencia. Con dos listas apiladas el CTA "Ir a comprar" va en línea
(`inlineCta` en web; `onEnterShopMode` en móvil).

**Verificación**: gates verdes (web lint 0 errores / typecheck / 114 tests; mobile `tsc`
0). Navegador como no planificador demo Marta (hogar Alex): marcar "en casa" y añadir a la
despensa → escrito en la fila de Alex (`Cebolla ownedTrips {0:"fridge"}`, `pantry_extras`),
fila propia de Marta intacta; modo compra marca `store` en la de Alex. Simulador como no
planificador Copiloto (hogar Nacho): mismo resultado, más el modo compra a pantalla
completa. Datos de prueba limpiados en las dos filas.
