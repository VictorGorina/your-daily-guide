# 01 · Cambiar a Optimizada a mitad de mes deja la despensa en una compra ya pasada

Status: resuelto (2026-10-04)

## Qué pasa

`stockUpAmounts` ([src/lib/shopping/trips.ts](../../../src/lib/shopping/trips.ts)) reparte siempre
desde la compra 1: lo que no caduca entra entero en ella. La proyección no sabe qué día es hoy.

Si alguien lleva dos semanas en cadencia semanal (compras 1 y 2 hechas) y cambia a Optimizada, el
arroz de las semanas 3 y 4 aparece en la compra 1, que ya pasó y se pinta en gris. Las compras 3 y
4 salen sin despensa, así que nada le avisa de que le falta por comprar. Además, al cambiar se
limpian las marcas "comprado" (`withoutStoreMarks`), de modo que la compra 1 pasada sale entera
como pendiente.

Lo mismo al revés no es grave: volver a semanal re-trocea por semana y solo pierde las marcas.

## Idea de arreglo

Anclar el reparto a la compra en curso: lo de las compras ya pasadas se queda donde estaba (como en
la semanal) y `stockUpAmounts` empieza a acumular desde la compra que toca hoy. Hace falta pasar el
día de hoy a `projectTrips` (hoy es pura y no lo recibe) o guardar en el plan desde qué compra
rige la optimizada (p. ej. `plan.cadenceFrom`), que es más estable: no cambia sola con los días.

## Cuidado con

- La invariante Σ entre compras = total del mes (test en `plan-shared.test.ts`).
- La copia del móvil (`mobile/lib/plan-shared.ts`) y `scripts/shared-exports.txt`.
- `projectTrips` también la usan `shoppingToText` y el contexto del coach.

## Comments

**2026-10-04 — hecho.** Se guarda el ancla en el plan (`MonthlyPlan.cadenceFrom`), no se pasa
"hoy" a la proyección: así el reparto no se mueve solo con los días.

- `stockUpStart` (trips.ts) da la compra que toca hoy; `recadencePlan` (nuevo
  `shopping/recadence.ts`, puro) la guarda al entrar en la optimizada con el mes en curso y la
  quita al salir. `recadenceMonthlyPlan` acepta `today` (`clampClientToday`).
- `projectTrips(..., stockUpFrom)`: las compras anteriores llevan lo de su semana y
  `stockUpAmounts` corre desde el ancla. Σ no cambia (test).
- Marcas "comprado": entre semanal y optimizada se conservan las de las compras anteriores al
  ancla (`withoutStoreMarks(lista, desde)`); desde/hacia bisemanal o mensual se quitan todas,
  porque los tramos no casan.
- `cleanPlan` y `mergeFuturePlan` conservan el campo. Móvil: copia en `plan-shared.ts`,
  `stockUpStart` en `shared-exports.txt`, la pantalla manda `today`.

Queda igual: quien cambia a mitad de la compra en curso y ya la había hecho ve esa compra otra
vez pendiente con la despensa del resto del mes (sus marcas "comprado" se quitan).
