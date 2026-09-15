# 11 — Correcciones de ayer y anteayer pasan por el núcleo de compensación

Status: ready
Blocked by: 06, 08
Tamaño: S

## Qué

Corregir en el detalle de un día pasado lo que se comió ("Comí distinto: pizza") en **ayer o
anteayer** analiza el cambio de macros con la misma tabla que cualquier cambio de plato y, si hace
falta, compensa en días posteriores a hoy. Las correcciones más antiguas solo actualizan el historial
y sus macros (ticket 06).

## Por qué

Decisión D1 ampliada por el usuario (2026-09-15): "sí compensar ayer y anteayer". Apuntar esta
mañana que anoche cenaste pizza tiene el mismo efecto que marcarlo en Hoy, que sí compensa. Corregir
un día de hace diez días y que cambie la cena de mañana resultaría raro.

## Diseño

### Qué cuenta como cambio

En `DayDetailBody`, al guardar una corrección:

| Antes | Después | `from` → `to` |
|---|---|---|
| Sin registrar / "Comí esto" (plato del plan P) | "Comí distinto: A" | P → A |
| "Comí distinto: A" | "Comí distinto: B" | A → B |
| "Comí distinto: A" | "Comí esto" | A → P |
| Cualquiera | "Me lo salté" | no se encola (saltarse una comida no es un cambio de plato; igual que en Hoy) |

### Ventana

- `PAST_COMPENSATION_DAYS = 2` en `src/lib/nutrition/compensation.ts` (y copia móvil).
- `isCompensablePastDate(date, today)`: `today − 2 ≤ date < today`.
- Fuera de la ventana no se encola nada.

### Núcleo (ticket 08)

- `DishChange` gana `kind: "plan" | "eaten"` (`"eaten"` = corrección de un día pasado).
- `compensateDishChanges` acepta `kind: "eaten"` solo si `isCompensablePastDate` (validación en
  servidor con la fecha de hoy de la zona de la persona, no la del cliente).
- Para `eaten`: sin `lockedDates` (el pasado nunca es editable); `window` = de `hoy + 1` a `hoy + 6`.
  Si esa ventana cruza de mes, se usa la parte del mes en curso y, si queda vacía, el mes siguiente
  cuando exista su plan.
- `note`: "Ayer en la cena comió «A» en vez de «P»".
- El lote se reusa tal cual (clave `${date}:${slot}`, `from` del primer cambio, volver a `from`
  borra la entrada).

### UI

- Resultado `adjusted` → línea en el detalle de ese día: "He ajustado 2 comidas para compensarlo ·
  Ver" → `AdjustmentInfoSheet`. Mientras está en el lote, `Loader2` junto a la línea de la comida.
- El pie del detalle ("Corregir aquí es solo para tu historial…") cambia según la fecha:
  - ayer / anteayer: "Si lo que comiste cambia mucho, ajusto los próximos días. La compra no cambia."
  - más atrás: se queda como está.

## Archivos

- `src/lib/nutrition/compensation.ts` + test, copia móvil
- `src/lib/dish-change-batch.ts`, `mobile/lib/dish-change-batch.ts`
- `src/lib/plan.functions.ts` (`compensateDishChanges`)
- `src/components/day-detail-sheet.tsx`, `mobile/components/day-detail-sheet.tsx`

## Criterios de aceptación

- [ ] Tests: `isCompensablePastDate` con hoy, ayer, anteayer, hace 3 días y cruce de mes.
- [ ] Test: la tabla "Antes / Después" produce el `from`/`to` correcto y "Me lo salté" no encola.
- [ ] Navegador (demo, objetivo perder): ayer, cena "Comí distinto: pizza cuatro quesos" → macros
      del día suben (06) y a los ~10 s "He ajustado N comidas" con días posteriores a hoy.
- [ ] Mismo cambio en un día de hace 4 días: macros del día suben, sin llamada a `plan/compensate`.
- [ ] Servidor: una petición manipulada con `kind: "eaten"` y fecha de hace 5 días se rechaza.
- [ ] Simulador: el caso de ayer.

## Comments
