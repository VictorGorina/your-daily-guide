# 01 — Helpers de semana (`week-nav`) y `withPlanMeal`

Status: resolved
Blocked by: —
Tamaño: S

## Qué

Sacar a funciones puras, con tests, todo lo que la tira necesita para paginar semanas y decidir qué
se puede editar. Extraer también la escritura de un plato en el plan para que servidor y cliente
(actualización optimista) usen la misma.

## Por qué

La tira calcula ahora la semana por dentro con `setDate` ([week-strip.tsx:31-40](../../../src/components/week-strip.tsx)).
Al paginar aparecen casos que un bug no enseña a simple vista: semanas entre dos meses (dos filas de
`monthly_plans`), el cambio de hora del 25-oct-2026 y los límites de alta / mes siguiente.

## Diseño

`src/lib/week-nav.ts` (puro, sin `@/` en el test) y copia en `mobile/lib/week-nav.ts`:

- `addDaysISO(date, n)`: aritmética en UTC.
- `weekStartOf(date)`: lunes de esa semana. Domingo → lunes anterior.
- `weekDates(monday)`: las 7 fechas.
- `weekStripBounds(today, appStartedOn)` → `{ first, last }` (lunes):
  - `first = weekStartOf(appStartedOn ?? today)`
  - `last = weekStartOf(último día de planNavBounds(today, appStartedOn).latest)`
- `weekIndexOf(monday, bounds)` y `mondayAt(index, bounds)`.
- `monthsOfWeek(monday)`: 1 o 2 meses `YYYY-MM`.
- `weekLabel(monday, today)`: "Esta semana" · "Semana pasada" · "Próxima semana" · "21–27 sep"
  (abreviatura de mes solo si cambia dentro de la semana: "29 sep – 5 oct").
- `dayKind(date, today, appStartedOn)`: `"before-start" | "past" | "today" | "future"`.
- `BACKFILL_WINDOW_DAYS = 45` (comentario apuntando a la migración
  `20260906120000_daily_logs_backfill_window.sql`).
- `isPastDayEditable(date, today, appStartedOn, hasLog)`: pasado, no antes del alta, y
  `hasLog || daysBetween(date, today) < BACKFILL_WINDOW_DAYS` (un día de margen: la policy usa el
  `current_date` de la base de datos, en UTC, y `today` es la fecha del dispositivo).

`src/lib/plan-shared.ts` (y `mobile/lib/plan-shared.ts`):

- `withPlanMeal(plan, date, slot, dish, off): MonthlyPlan | null`: lo que hoy hace
  `setPlanMeal` inline ([plan.functions.ts:1676-1695](../../../src/lib/plan.functions.ts)). `null` si
  la fecha no tiene celda (`planSlotIndex`). `setPlanMeal` pasa a usarla sin cambiar su
  comportamiento. El ticket 02 le añade `pinned`.

## Archivos

- `src/lib/week-nav.ts` + `src/lib/week-nav.test.ts`
- `mobile/lib/week-nav.ts`
- `src/lib/plan-shared.ts`, `src/lib/plan-shared.test.ts`, `mobile/lib/plan-shared.ts`
- `src/lib/plan.functions.ts` (`setPlanMeal` usa `withPlanMeal`)

## Criterios de aceptación

- [x] Tests: domingo 20-sep-2026 → lunes 14; semana del cambio de hora da 7 fechas seguidas;
      semana 28-sep → 4-oct da `["2026-09", "2026-10"]`; `weekStripBounds` con alta a mitad de
      semana, sin alta, con mes siguiente bloqueado (hoy 15-sep) y desbloqueado (hoy 25-sep).
- [x] Tests: `isPastDayEditable` en 44 y 45 días sin registro, con registro, antes del alta.
- [x] Tests: `withPlanMeal` escribe `lunch`/`dinner`/`breakfast`/`snack` y gestiona `extras` igual
      que antes; `null` para una fecha sin celda.
- [x] `bun run lint && bun run typecheck && bun run test` en verde.

## Comments

- 2026-09-15 — Hecho. `src/lib/week-nav.ts` + `week-nav.test.ts` (21 tests; los días de la semana
  esperados, cruzados con el calendario del sistema) y copia en `mobile/lib/week-nav.ts` (idéntica
  salvo el import relativo). `withPlanMeal` en `src/lib/plan-shared.ts` y `mobile/lib/plan-shared.ts`
  (con `MEAL_SLOT_FIELD`, que faltaba en móvil); `setPlanMeal` ya escribe con ella.
  Puertas: `tsc` web y móvil limpios, `bun run test` 327/327, ESLint y Prettier limpios en los
  archivos tocados. `bun run lint` global da 10 errores, todos en
  `.claude/worktrees/sleepy-zhukovsky-ab234e/` (worktree de otra sesión; el CI no lo ve).
- Desviación: la ventana sin registro es `< 45` días en vez de `<= 45`, por el margen de zona horaria
  explicado arriba.
