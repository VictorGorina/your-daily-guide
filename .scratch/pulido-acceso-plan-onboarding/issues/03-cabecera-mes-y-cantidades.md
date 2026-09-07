# 03 — Plan: cabecera del mes en dos líneas y cantidades comprables

Status: sin empezar
Incidencias del usuario: ⓹ (se corta "Septiembre de 2026") + ⓺ (redondear a la decena)

## Objetivo

Que el mes se lea entero en la cabecera del Plan y que la lista de la compra pida cantidades
que una persona pueda comprar de verdad.

## Tareas

### A. Cabecera del mes (⓹)

1. `src/routes/_authenticated/plan.tsx:504`: el `<h1>` usa `text-[28px]` + `truncate` entre dos
   botones de 32 px; a 375 px se lee "Septiembre de …". Pasar a **dos líneas**: mes arriba y
   año debajo, más pequeño y en tono apagado, quitando el `truncate`.
2. Añadir un helper junto a `monthTitle` en `src/lib/plan-shared.ts` que devuelva mes y año por
   separado, en vez de partir la cadena ya formateada en el componente (el formato viene de
   `toLocaleDateString` y cambia con el idioma).
3. Repasar que la cabecera no descuadre cuando el botón derecho es el candado (`nextIsLocked`)
   en vez del chevron.
4. Replicar en `mobile/app/(app)/plan.tsx:513` y `mobile/lib/plan-shared.ts:488`.

### B. Cantidades (⓺)

5. `formatQty` (`src/lib/plan-shared.ts:173`) redondea a la unidad: en cadencia semanal salen
   "214 g", "143 g", "7 g". Añadir un redondeo **por tramos que escale con la magnitud** — p.ej.
   por debajo de 10 dejar el valor, decenas hasta 100, medias centenas hasta 1000, y medios kg
   por encima. Ajustar los cortes a ojo de comprador, no a una fórmula bonita.
6. **Nunca redondear a cero**: `7 g de cúrcuma` debe seguir siendo comprable, no "0 g".
7. Replicar en `mobile/lib/plan-shared.ts:392`.

## Verificación

- Navegador con perfil demo, viewport 375: cabecera legible en un mes largo ("Septiembre",
  "Noviembre", "Diciembre") y con el candado a la derecha.
- Subpestaña Ingredientes, cambiando la cadencia entre Semanal / Cada 2 semanas / Mensual: las
  cantidades se leen como una lista de la compra en las tres.
- `bun run test` verde, **incluida la invariante de `plan-shared.test.ts`**.

## Hecho cuando

El mes se lee entero y ninguna fila de la compra pide una cantidad que nadie compraría, en las
dos apps, sin que se mueva ningún total.

## Notas — la trampa de este ticket

`weekQty` es el modelo canónico y la invariante del proyecto es **Σ entre compras = lo que
pide el mes**, estable al cambiar de cadencia, cubierta por tests. **Redondear SOLO en
`formatQty`, es decir al pintar.** Si el redondeo baja al dato guardado o a `projectTrips`, la
invariante se rompe y los tests se caen. Tampoco tocar los precios: nunca se escala un precio
sin escalar su cantidad.

## Datos reales del bug (perfil demo, cadencia semanal)

```
Zanahoria 214 g · Espinacas frescas 143 g · Calabacín 286 g · Tomate triturado 357 ml
Salmón congelado 179 g · Pechuga de pollo 357 g · Café 71 g · Cúrcuma 7 g · Curry 7 g
```
