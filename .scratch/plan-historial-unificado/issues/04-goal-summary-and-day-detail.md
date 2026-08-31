# 04 — `<GoalWeightSummary>` + `<DayDetailSheet>`

Status: todo
Blocked by: 03

Hacer **mobile primero**, verificar en simulador, luego web.

## `<GoalWeightSummary>` — `src/components/goal-weight-summary.tsx` (+ mobile)

Extraer de `historial-section.tsx`:

- El bloque `ProgressBar` del objetivo (`goalProgress`, `goal_type === "mantener"` → label
  "Estabilidad", `goal_target_date` → caption "meta: dd/mm/aaaa").
- `WeightTrend` (sparkline SVG de los últimos 10 pesajes con `weight_kg`).
- Helper `formatMetaDate`.
  Props: `{ logs: DailyLog[]; profile: Profile | null }`. Sin `AdherenceHeatmap`.

## `<DayDetailSheet>` — `src/components/day-detail-sheet.tsx` (+ mobile, sheet/Dialog RN)

Props: `{ date: string; plan: MonthlyPlan | null; log: DailyLog | undefined; profile: Profile | null; onClose: () => void }`.

Contenido:

1. Cabecera: `weekday, día mes` (capitalize).
2. **Comidas**: cruzar `mealsForDate(plan, date)` con `log?.habits` por `label`/`moment`:
   | `habit.status`                          | Render                                                            |
   | --------------------------------------- | ----------------------------------------------------------------- |
   | `"plan"`                                | plato · tinte verde · "Comiste lo del plan"                       |
   | `"distinto"` + `wasIdea` (≠ idea)       | plato real en `text-primary` + `wasIdea` tachado, "Plan sugerido" |
   | `"distinto"` sin `wasIdea`              | plato planificado + "Comiste otra cosa"                           |
   | `"salteo"`                              | plato planificado tachado, apagado, "Te lo saltaste"              |
   | `null`                                  | plato planificado, apagado, "Sin registrar"                       |
   | Resumen: "X de Y comidas · N saltadas". |
3. **Macros del día**:
   `<MacroBars estimate={sumDoneMacros(log?.guide?.mealMacros, log?.habits ?? []) ?? ZERO_MACROS}
target={log?.guide?.macroEstimate ?? null} weightKg={profile?.current_weight_kg ?? null} />`.
   Si `!log?.guide` → texto "No hay estimación de macros para este día".
4. **Corrección retroactiva** (solo `date < todayISO()`): chips `MEAL_STATUS_LABEL` por comida
   → `updateLogByDate(date, { habits: next })`; `done = status === "plan" || "distinto"`.
   `onSuccess` → invalidar `["logs"]` y `["logs", date.slice(0,7)]`. Nota:
   "Corregir aquí es solo para tu historial: la compra ya hecha de ese mes no cambia."

**Excluido a propósito**: `DishRecipe`, mensajes del coach (`fetchMessages`), `guide.intro`,
`guide.tips`.

## Hecho cuando

- El sheet abre desde un día pasado con datos y sin datos; la corrección persiste y refresca.
- Verificado en simulador iOS (screenshot).
- `typecheck` / `lint` / `bun test` limpios.
