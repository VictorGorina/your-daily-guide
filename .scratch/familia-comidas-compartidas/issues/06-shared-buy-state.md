# 06 — Estado de compra y despensa compartidos

Status: todo
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
