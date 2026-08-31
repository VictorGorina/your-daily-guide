# 03 — Capa de datos por mes + extraer macros a módulo compartido

Status: todo
Blocked by: —

## Objetivo

Poder cargar los logs y el plan de cualquier mes seleccionado, y reutilizar la barra de
macros de Hoy en el detalle de día.

## Tareas

### `src/lib/daily.ts` (+ `mobile/lib/daily.ts`)

- `fetchLogsForMonth(month: "YYYY-MM"): Promise<DailyLog[]>` —
  `.gte("log_date", \`${month}-01\`).lte("log_date", <fin de mes>)`. Query key `["logs", month]`.
- Dejar `fetchLogs()` (límite 120) como está para `impulso` / `WeightTrend` / objetivo.
- (El suelo del `‹` sale de `profiles.app_started_on`, no de un `fetchPlanMonths`.)

### `src/lib/macros.ts` (nuevo, sin React) + `mobile/lib/macros.ts`

Mover **tal cual** desde `src/routes/_authenticated/hoy.tsx`:

- `ZERO_MACROS`
- `sumDoneMacros(mealMacros, habits)`
- `macroTargets(weightKg)`
  `hoy.tsx` pasa a importarlos. Sin cambios de comportamiento.

### `src/components/macro-bars.tsx` (nuevo) + equivalente mobile

Mover `MacroBars` desde `hoy.tsx` (web) y desde `mobile/app/(app)/hoy.tsx` (comprobar nombre
allí). Props idénticas: `{ estimate, target, weightKg }`. `hoy.tsx` lo importa.

## Hecho cuando

- Hoy se ve idéntico (screenshot antes/después, y en simulador iOS).
- `fetchLogsForMonth("2026-07")` devuelve solo julio.
- `typecheck` / `lint` / `bun test` limpios.

Blocked by: — (independiente; puede ir en paralelo a 01/02)
