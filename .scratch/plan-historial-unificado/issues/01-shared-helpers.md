# 01 — Helpers de navegación de mes + consolidación de constantes

Status: todo
Blocked by: —

## Objetivo

Poner en `plan-shared.ts` (web **y** `mobile/lib/plan-shared.ts`, copias idénticas) toda la
lógica de "qué mes puedo ver / generar", con una única fuente de verdad para el umbral de 7
días.

## Tareas

1. Añadir a `src/lib/plan-shared.ts` y `mobile/lib/plan-shared.ts`:
   - `addMonths(month: "YYYY-MM", delta: number): string`
   - `monthTitle(month: "YYYY-MM"): string` → `"agosto de 2026"`
   - `daysLeftInMonth(dateISO: "YYYY-MM-DD"): number` (contando hoy)
   - `nextMonthISO(dateISO: "YYYY-MM-DD"): "YYYY-MM"`
   - `export const NEXT_MONTH_UNLOCK_DAYS = 7`
   - `isNextMonthUnlocked(today: "YYYY-MM-DD"): boolean`
   - `planMonthStatus(month, today): "past" | "current" | "next-locked" | "next-unlocked" | "far-future"`
   - `isMonthActionable(month, today): boolean`
   - `planNavBounds(today, appStartedOn: string | null): { earliest: string; latest: string }`
     — `earliest = min(currentMonth, monthOf(appStartedOn ?? today))`
   - `isBeforeAppStart(dateISO, appStartedOn: string | null): boolean`
2. `push-dispatch.server.ts`: borrar las copias locales de `daysLeftInMonth` y `nextMonthOf`,
   importar de `plan-shared`. `RENEWAL_DAYS_LEFT` pasa a ser `NEXT_MONTH_UNLOCK_DAYS`.
3. Reemplazar los `new Date(...).toLocaleDateString("es-ES", { month, year })` sueltos de
   `plan.tsx` (web y mobile) por `monthTitle`.

## Tests — `src/lib/plan-shared.test.ts`

- `addMonths("2026-12", 1) === "2027-01"`, `addMonths("2026-01", -1) === "2025-12"`.
- `isNextMonthUnlocked`: día con 8 restantes → `false`; con 7 → `true`; con 1 → `true`.
- `planMonthStatus`: mes-1 → `past`; mes actual → `current`; mes+1 con 10 días restantes →
  `next-locked`; mes+1 con 5 → `next-unlocked`; mes+2 → `far-future`.
- `planNavBounds`: `appStartedOn === null` → `earliest === currentMonth`; con
  `"2026-05-14"` → `earliest === "2026-05"`; `latest` = mes actual si bloqueado, mes+1 si
  desbloqueado.
- `isBeforeAppStart("2026-05-10", "2026-05-14") === true`; `("2026-05-20", "2026-05-14") === false`.

## Hecho cuando

`bun test` verde; `bun run typecheck` y `bun run lint` limpios; push-dispatch sin copias
locales duplicadas.
