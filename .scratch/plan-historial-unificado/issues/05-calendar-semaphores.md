# 05 — Semáforo por día en el calendario + apertura de detalle

Status: todo
Blocked by: 04

Mobile primero (calendario inline en `mobile/app/(app)/plan.tsx`, ~línea 359), luego web
(`src/components/plan-month-calendar.tsx`).

## Props nuevas

`logs: DailyLog[]` (del mes mostrado), `monthStatus: PlanMonthStatus`,
`appStartedOn: string | null`, `onOpenDay(date: string) => void`.

## Reglas de celda

| Caso                                                                   | Aspecto                                                                        | Al tocar                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `date === today`                                                       | anillo primario (como ahora)                                                   | diálogo menú del día (existente)                     |
| `date < today` con log                                                 | fondo/punto = `ratioSignal(hechas, total)` (verde/amarillo/gris; **sin rojo**) | `onOpenDay(date)`                                    |
| `date < today` sin log                                                 | neutro (`none`)                                                                | `onOpenDay(date)` (el sheet muestra "Sin registrar") |
| `date > today`, mes actual, o cualquier día de mes futuro desbloqueado | neutro                                                                         | diálogo menú del día                                 |
| `beforeStart` (cobertura parcial) sin log                              | apagado, no abrible (como ahora)                                               | —                                                    |
| `beforeStart` con log                                                  | semáforo                                                                       | `onOpenDay(date)`                                    |
| `isBeforeAppStart(date, appStartedOn)`                                 | apagado, inerte                                                                | — (o detalle con "Antes de empezar a usar Peppers")  |

- Mes entero pasado → todos "pasado": semáforo donde haya log, `none` si no.
- `doneCount`/`total` de un día: `log.habits.filter(h => h.done).length` / `log.habits.length`
  (mismo criterio que `WeekStrip` / `AdherenceHeatmap`).

## Leyenda

Añadir bajo el calendario el texto que hoy tiene `AdherenceHeatmap`:
"Verde: todas las comidas. Amarillo: comiste algo. Gris: sin comidas ese día."

## Wiring en `plan.tsx`

`plan.tsx` pasa `logs={monthLogs}` (de `["logs", selectedMonth]` vía `fetchLogsForMonth`) y
`onOpenDay={setOpenDay}`; renderiza `<DayDetailSheet>` cuando `openDay != null`.

## Hecho cuando

- Un mes con historial muestra semáforos correctos; tocar abre el sheet.
- El mes en curso: pasado con semáforo, hoy con anillo, futuro neutro.
- Verificado en simulador iOS (screenshot con un mes que tenga logs).
- `typecheck` / `lint` limpios.
