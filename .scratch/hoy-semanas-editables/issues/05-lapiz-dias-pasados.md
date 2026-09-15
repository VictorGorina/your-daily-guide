# 05 — Días pasados: lápiz visible y reglas de "editable"

Status: ready
Blocked by: 03, 04
Tamaño: S

## Qué

Al tocar un día pasado editable aparece un lápiz en su casilla, y cada comida del detalle lleva un
botón lápiz que abre la corrección. Donde no se puede editar no hay lápiz y se explica el motivo.

## Por qué

Petición del usuario: "cuando clickas en un día pasado debería salir el lápiz para dejar claro que
se puede modificar". Ahora la corrección se abre tocando la fila entera, sin ninguna pista: va contra
la §9 de `docs/design-guidelines.md` ("esconder una acción frecuente detrás de un despliegue").

## Diseño

### Casilla (vía `renderBadge` del pager)

- Si `selected === date && isPastDayEditable(...)`: círculo de 16 px (`bg-surface`, `PencilLine`
  10 px, `text-foreground`) en la esquina superior derecha, con `animate-pop` (web) o secuencia
  `withSequence` .94 → 1.04 → 1 en 350 ms (móvil). No es zona de toque; la casilla sigue siéndolo.

### `DayDetailBody` (web y móvil; lo comparte el `DayDetailSheet` de Plan)

- Nueva prop `editable` calculada fuera con `isPastDayEditable(date, today, appStartedOn, !!log)`,
  en vez de `date < todayISO()` dentro.
- Cada fila: botón de 30 px (`PencilLine` 15 px, `bg-surface text-muted-foreground`, mismo que "Comí
  otra cosa" en Hoy) a la derecha de la etiqueta de estado. La fila sigue siendo pulsable.
- El editor inline actual (chips de estado + "¿Qué comiste realmente?") se despliega con transición
  de altura (350 ms) en vez de aparecer de golpe.
- Pasado no editable con fila vacía: "Este día ya queda muy lejos para rellenarlo." (antes salía "No
  registraste ninguna comida" sin forma de corregirlo).

### Texto bajo la tira (Hoy)

- Pasado editable: "Toca el lápiz para corregir lo que comiste."
- Futuro (ticket 07): "Toca el lápiz para cambiar un plato."
- Sin día abierto: "Desliza para ver otras semanas. Toca un día para ver su menú."

## Archivos

- `src/components/day-detail-sheet.tsx`, `mobile/components/day-detail-sheet.tsx`
- `src/components/week-pager.tsx`, `mobile/components/week-pager.tsx`
- `src/routes/_authenticated/hoy.tsx`, `mobile/app/(app)/hoy.tsx`
- `src/routes/_authenticated/plan.tsx`, `mobile/app/(app)/plan.tsx` (pasar `editable`)

## Criterios de aceptación

- [ ] Simulador y navegador (demo): tocar ayer → pop del lápiz en la casilla y lápiz en cada comida;
      tocar el lápiz abre la corrección con animación; guardar actualiza el semáforo de la casilla
      (transición de 350 ms).
- [ ] Día de hace > 45 días sin registro: sin lápiz y con la línea explicativa.
- [ ] Plan → calendario → día pasado: mismo lápiz por comida.

## Comments
