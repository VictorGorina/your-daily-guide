# 02 · El aviso de frescos no distingue la cadencia optimizada

Status: resuelto (2026-10-04)

## Qué pasa

`freshRisksForTrip` ([src/lib/perishability.ts](../../../src/lib/perishability.ts)) avisa de los
frescos que no aguantan el tramo de días de una compra. En un mes de 31 días las compras semanales
son de 8 días, así que avisa de todo lo que dura 7 o menos: "Espinacas, Tomate y 3 más no aguantan
los 8 días de esta compra".

En Optimizada sale el mismo aviso, con el mismo texto. Es correcto para el pescado o la espinaca,
pero choca con el mensaje de la cadencia ("las demás compras, solo lo fresco") y mete en el mismo
saco al tomate o al yogur, que se quedan a un día.

No se tocó al implementar la cadencia para no cambiar el comportamiento de la semanal.

## A decidir

1. ¿Tolerancia de un día en el aviso (también en semanal), para que 7 días frente a 8 no salte?
   `stockUpAmounts` ya usa esa tolerancia: "comprado el día `from`, dura hasta `from + shelf`".
2. ¿Texto propio en Optimizada, que diga qué hacer con lo que no llega (congelar, o comprarlo el
   día que se cocina)?

## Cuidado con

- `perishability.test.ts` y la copia del móvil (`mobile/lib/perishability.ts`).
- Decisión vigente: sesgar y avisar, sin compras extra ni cambiar la lista (AGENTS.md).

## Comments

**2026-10-04 — decidido por el usuario y hecho.**

1. Tolerancia de un día, en todas las cadencias: `freshRisksForTrip` usa la cuenta de
   `stockUpAmounts` (avisa si `vida < to - from`). Tomate y yogur dejan de saltar en una compra de
   8 días; pescado, carne, hojas y brócoli siguen.
2. Texto propio en Optimizada: "… no aguantan hasta la próxima compra. Congélalos al llegar o
   cómpralos el día que los cocines." Las demás cadencias conservan el suyo. El aviso entero lo
   escribe `freshRiskText` (perishability.ts, copia en el móvil), en Ingredientes y en modo compra.
