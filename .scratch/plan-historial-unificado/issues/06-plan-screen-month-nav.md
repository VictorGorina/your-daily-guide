# 06 — Navegador de mes + reestructura a 2 subpestañas + gating de Ingredientes

Status: todo
Blocked by: 01, 05

Mobile primero (`mobile/app/(app)/plan.tsx`), verificar en simulador, luego web
(`src/routes/_authenticated/plan.tsx`).

## `validateSearch` / params

- web: `tab?: "plan" | "compra"` (quitar `"historial"`); `month?: "YYYY-MM"` (validar forma).
- mobile: `useLocalSearchParams` — aceptar `tab` (`compra`) y `month`.

## Estado

- `const [selectedMonth, setSelectedMonth] = useState(searchMonth ?? monthISO())`.
- Sustituir **todos** los `month` por `selectedMonth`: `["plan", selectedMonth]`, y payloads
  de `generate` / `recadence` / `owned` / `setActual` / `confirmTrip`.
- `monthLogsQ = useQuery(["logs", selectedMonth], () => fetchLogsForMonth(selectedMonth))`;
  `globalLogsQ = useQuery(["logs"], fetchLogs)` (para `GoalWeightSummary` / impulso).
- `monthStatus = planMonthStatus(selectedMonth, todayISO())`;
  `actionable = isMonthActionable(selectedMonth, todayISO())`;
  `bounds = planNavBounds(todayISO(), profileQ.data?.app_started_on ?? null)`.

## Cabecera → navegador de mes

`‹` · `monthTitle(selectedMonth)` (capitalize) · `›`

- `‹` `disabled = selectedMonth <= bounds.earliest` (mes de la fecha de alta).
- `›` `disabled = selectedMonth >= bounds.latest`.
- Si el usuario intenta pasar a un `next-locked` (no debería poder, el `›` está disabled),
  toast: "Podrás preparar {monthTitle} a partir del {fecha del día `1 - 7`}".
- Botón `RefreshCw` (regenerar): solo si `plan && actionable`.

## Subpestañas: 2 (Plan, Ingredientes)

Quitar la entrada `["historial", …]` y la rama `tab === "historial"`.

### Subpestaña Plan (orden)

1. `<GoalWeightSummary logs={globalLogsQ.data ?? []} profile={profileQ.data ?? null} />`
   (siempre, es transversal — ver pregunta abierta 2 del spec).
2. Tarjeta "Cómo enfocamos el mes" (existente) — solo si hay `plan`.
3. `<PlanMonthCalendar plan={plan} month={selectedMonth} logs={monthLogsQ.data ?? []}
monthStatus={monthStatus} onOpenDay={setOpenDay} />`.
4. `<DayDetailSheet>` cuando `openDay`.

### Subpestaña Ingredientes según `monthStatus`

| status                       | comportamiento                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `current`                    | como ahora                                                                                                                                                                                                            |
| `next-unlocked`              | plenamente accionable; **todas las compras se tratan como `current`** (flag `allTripsCurrent` a `IngredientsTab` → `editable` siempre true, sin estilos past/future). Simplificación deliberada (pregunta abierta 3). |
| `past`                       | **solo lectura**: ocultar CTA "Ir a comprar", selector de cadencia, campo de gasto y entrada a Modo compra; lista visible sin `onClick`. Nota cabecera "Compra de {mes} — solo lectura".                              |
| `next-locked` / `far-future` | inalcanzable (el `›` para antes)                                                                                                                                                                                      |

### Estados vacíos (`!plan`)

| status                               | UI                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| `current`                            | "Crear plan del mes" (existente, pantalla completa)                                  |
| `next-unlocked`                      | "Prepara tu plan de {mes} para comprar antes de que empiece" + "Crear plan de {mes}" |
| `past` con logs                      | subpestaña Plan con `GoalWeightSummary` + calendario, sin tarjeta intro              |
| `past` sin logs ni plan (mes ≥ alta) | "No planificaste {mes}"                                                              |

## Días previos a la fecha de alta

`isBeforeAppStart(date, profileQ.data?.app_started_on ?? null)` → celda inerte en el
calendario (igual que `beforeStart` de cobertura parcial); si se abre el detalle, muestra
"Antes de empezar a usar Peppers". Meses enteros anteriores al de alta no son alcanzables
(el `‹` para en `bounds.earliest`).

## Otros

- `shopMode` sin cambios; solo alcanzable si `actionable`.
- `bottom-nav.tsx` (web + mobile): actualizar comentario sobre Historial.

## Hecho cuando

- Navegar meses atrás/adelante respeta `bounds`; Ingredientes cambia de modo según el mes.
- Screenshot en simulador: mes en curso, un mes pasado, y (simulando fecha) el mes que viene
  desbloqueado.
- `typecheck` / `lint` / `bun test` limpios.
