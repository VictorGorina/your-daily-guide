# Spec — Unificar Historial dentro de la subpestaña Plan + navegación de meses

Status: implementado en la rama `unifica-historial-en-plan` (2026-08-31), pendiente de commit
Autor: sesión Claude Code, 2026-08-31
Feature slug: `plan-historial-unificado`

## Resumen en una frase

Eliminar la subpestaña **Historial** de la pantalla Plan y fundir su contenido en la
subpestaña **Plan**: el calendario del mes pasa a ser el navegador del historial (semáforo
por día, detalle de día reducido), y se añade un selector de mes en la cabecera que permite
ver meses anteriores (solo lectura) y el mes siguiente (bloqueado hasta la última semana del
mes, para poder comprar antes de que empiece).

---

## 1. Estado actual (lo que hay hoy en `main`)

- **`src/routes/_authenticated/plan.tsx`** (web) y **`mobile/app/(app)/plan.tsx`**: pantalla
  Plan con `month = monthISO()` fijo y tres subpestañas en una píldora:
  `["plan", "Plan"] · ["compra", "Ingredientes"] · ["historial", "Historial"]`.
  - `tab === "plan"` → tarjeta "Cómo enfocamos el mes" + `<PlanMonthCalendar plan month />`.
  - `tab === "compra"` → `<IngredientsTab>` (rediseño "una compra a la vez", chips
    Falta/Tengo/Todo, navegador ← → de compras) o `<ShopModeView>` a pantalla completa
    cuando `shopMode`. Ver memoria `plan-ingredientes-redesign`.
  - `tab === "historial"` → `<HistorialSection />`.
- **`src/components/historial-section.tsx`** (web, 310 líneas) y
  **`mobile/components/historial-section.tsx`** (325 líneas):
  - `ProgressBar` del objetivo (`goalProgress`) + `WeightTrend` (mini-sparkline SVG de los
    últimos 10 pesajes).
  - `AdherenceHeatmap` — malla de 14 días con el semáforo `ratioSignal` (verde/amarillo/gris).
  - Listado "Conversación por día": `DayRow` por cada `DailyLog`, expandible, con:
    - corrección retroactiva del estado de cada comida (`updateLogByDate` → chips
      `MEAL_STATUS_LABEL`), deshabilitada para el día de hoy;
    - los mensajes del chat del coach de ese día (`fetchMessages`).
- **`src/components/plan-month-calendar.tsx`** (web, componente propio) y
  **`PlanMonthCalendar` inline en `mobile/app/(app)/plan.tsx`** (~línea 359): cuadrícula del
  mes; los días previos a `coverage.fromDay` salen apagados y no se pueden abrir; el resto
  abre un `<Dialog>` con el menú de ese día (`mealsForDate`). No hay semáforo por día.
- **`src/routes/_authenticated/historial.tsx`** y **`mobile/app/(app)/historial.tsx`**:
  redirects a `/plan?tab=historial` (para no romper enlaces/notificaciones antiguos).
- **`src/lib/plan-shared.ts`** (+ copia `mobile/lib/plan-shared.ts`): `monthCoverage`,
  `daysInMonth`, `tripDayRange`, `tripTiming`, `tripLabel`, `planForDate`, `mealsForDate`,
  `planCursor`, `mergeFuturePlan`, etc. Hay `src/lib/plan-shared.test.ts` (runner: `bun test`).
- **`src/lib/plan.functions.ts`**: `generateMonthlyPlan` usa `.validator(...)` (renombrado
  desde `.inputValidator`) y `monthCoverage(month, today)` — que ya arranca el plan del mes
  en curso en el día de hoy (`fromDay = díaDeHoy`), y en el día 1 si el mes es futuro. No hay
  ninguna barrera contra generar un mes pasado.
- **`src/lib/push-dispatch.server.ts`**: `RENEWAL_DAYS_LEFT = 5` — a 5 días o menos de fin de
  mes, si no hay plan del mes siguiente, manda el push "prepara el plan del mes que viene"
  (link a `/hoy`). Tiene copias locales de `daysLeftInMonth` y `nextMonthOf`.
- **`src/lib/household.server.ts`** `syncSharedMeals`: usa `planCursor(opts.today)` para
  decidir qué semanas/días son "futuros" y por tanto sincronizables entre miembros del hogar.
- **`src/routes/_authenticated/hoy.tsx`**: `MacroBars`, `sumDoneMacros`, `ZERO_MACROS`,
  `macroTargets` son privados del módulo (~líneas 686-790). `daily_logs.guide` guarda por día
  `macroEstimate` (objetivo del día) y `mealMacros` (estimación por plato) — o sea, **el
  histórico de macros por día ya está persistido**.
- **RLS**: `monthly_plans` tiene policy `"own monthly plans" FOR ALL` → leer meses
  pasados/futuros propios ya está permitido, sin migración. `daily_logs` tiene `"update own
logs"` (migración `20260815130000`) → la corrección retroactiva ya funciona a nivel BD.
- **CLAUDE.md** dice "No hay suite de tests" — está desactualizado; sí la hay (`bun test`).

---

## 2. Decisiones de diseño (tomadas en esta sesión + memorias vigentes)

| #   | Decisión                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Un selector de mes `‹ [Mes Año] ›` en la cabecera de Plan** que afecta a TODA la pantalla: tanto la subpestaña "Plan" (calendario) como "Ingredientes" muestran el mes seleccionado. La subpestaña "Historial" desaparece → quedan **2 subpestañas: Plan, Ingredientes**.                                                                                                                                                                                                                                                                                                                                  |
| D2  | La subpestaña **Plan** pasa a ser, de arriba abajo: (a) resumen del objetivo + tendencia de peso (movidos desde Historial), (b) tarjeta "Cómo enfocamos el mes" (existente), (c) calendario del mes con semáforo por día. **Se elimina** el mapa de calor de 14 días (`AdherenceHeatmap`): el semáforo del propio calendario lo sustituye.                                                                                                                                                                                                                                                                   |
| D3  | Los **días anteriores a hoy** (en el mes en curso o en un mes pasado) llevan en el calendario el **semáforo de cumplimiento** (`ratioSignal`, **sin rojo** — gris apagado para un día flojo, nunca "fallo"; ver `ux-roadmap`). Tocar un día pasado abre un **detalle de día reducido**: comidas comidas / comidas falladas (con el plato sugerido cuando se cambió) + macros del día (comido vs. estimación). **Sin chat del coach, sin intro/tips de la guía.** Se **mantiene** la corrección retroactiva del estado de una comida.                                                                         |
| D4  | `generateMonthlyPlan` queda **bloqueado en servidor** para cualquier mes anterior al mes en curso (Madrid), y para el mes siguiente mientras falte **más de 7 días naturales** para su día 1. Meses a 2+ vista nunca son generables ni seleccionables. (Punto 4 + 6 del pedido.)                                                                                                                                                                                                                                                                                                                             |
| D5  | El **mes siguiente se desbloquea** cuando `daysLeftInMonth(today) <= 7`. Desbloqueado y seleccionado, la subpestaña **Ingredientes es plenamente accionable** (marcar "en casa", Modo compra, cadencia, gasto) para poder comprar antes de que empiece el mes. El push de renovación (`RENEWAL_DAYS_LEFT`) pasa de **5 → 7** para alinearse con este desbloqueo.                                                                                                                                                                                                                                             |
| D6  | Los **meses pasados son solo lectura**: sin botón de regenerar, sin acciones en Ingredientes (lista visible pero no interactiva), y los días del calendario abren el detalle de día.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D7  | **Fecha de alta explícita** (respuesta a la pregunta abierta 1). Se guarda `profiles.app_started_on` (una fecha, fijada al completar el onboarding; backfill = `created_at::date` para los usuarios existentes). Su mes es el **suelo absoluto** de la navegación (`‹` no baja de ahí) y los días anteriores a esa fecha, incluso dentro de su propio mes, salen inertes con "Antes de empezar a usar Peppers", no como "sin registrar". El mes en curso ya arranca el plan en el día de hoy vía `monthCoverage` — eso no cambia. La barrera de D4 en `generateMonthlyPlan` sigue, como cinturón y tirantes. |
| D8  | `<GoalWeightSummary>` (objetivo + peso) se muestra **siempre**, con datos globales, sea cual sea el mes seleccionado — es una foto transversal, no del mes (respuesta a la pregunta abierta 2).                                                                                                                                                                                                                                                                                                                                                                                                              |
| D9  | Con el mes siguiente desbloqueado y cadencia semanal/bisemanal, **todas las compras de ese mes se tratan como accionables a la vez** (el usuario hace toda la compra pre-mes de una) — no se respeta el escalonado semana a semana (respuesta a la pregunta abierta 3).                                                                                                                                                                                                                                                                                                                                      |

Memorias que restringen el trabajo: `ux-roadmap` (sin mecánicas de castigo, semáforo sin
rojo), `plan-ingredientes-redesign` (un solo estado por ingrediente, Modo compra a pantalla
completa sin nav ni burbuja), `peppers-design` (el diseño visual sale de Claude Design
"Rediseño Peppers nutrición", no se improvisa), `native-ios-app` (**portar a `mobile/`
primero y verificar en el simulador** antes de dar por hecho nada).

---

## 3. Cambios por capa

### 3.0 Migración — `profiles.app_started_on` (fecha de alta, D7)

`supabase/migrations/<ts>_profile_app_started_on.sql`:

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS app_started_on date;
-- Backfill: los usuarios que ya han onboarding-eado arrancan en su fecha de alta de cuenta.
UPDATE public.profiles
  SET app_started_on = created_at::date
  WHERE app_started_on IS NULL AND onboarding_completed;
```

- Regenerar `src/integrations/supabase/types.ts` (`bun run db` o el flujo habitual) y añadir
  `app_started_on: string | null` a `Profile` en `src/lib/daily.ts` y `mobile/lib/daily.ts`.
- **Onboarding**: en `src/routes/_authenticated/onboarding.tsx` (~línea 596, el
  `saveProfile({ onboarding_completed: true, ... })`), añadir
  `app_started_on: todayISO()` **solo si el perfil actual lo tiene `null`** (no pisar si ya
  existe, para que reeditar el onboarding no lo reinicie). Igual en el onboarding de `mobile/`.
- Perfil demo (`src/lib/demo-profile.ts` + `mobile/lib/demo-profile.ts`): fijar
  `app_started_on` a una fecha realista (p. ej. hace ~40 días) para que la navegación de meses
  tenga algo que enseñar en las demos.

### 3.1 Helpers compartidos — `src/lib/plan-shared.ts` **y** `mobile/lib/plan-shared.ts` (dos copias idénticas)

Añadir (con tests en `src/lib/plan-shared.test.ts`):

- `addMonths(month: "YYYY-MM", delta: number): string`
- `monthTitle(month: "YYYY-MM"): string` → `"agosto de 2026"` (dedup de los
  `toLocaleDateString` sueltos que hay repartidos por `plan.tsx`).
- `daysLeftInMonth(dateISO: "YYYY-MM-DD"): number` — contando hoy (1 = hoy es el último día).
  **Mover aquí** la copia que hoy vive en `push-dispatch.server.ts` y reexportarla.
- `nextMonthISO(dateISO: "YYYY-MM-DD"): "YYYY-MM"` — **mover aquí** `nextMonthOf` de
  `push-dispatch.server.ts`.
- `NEXT_MONTH_UNLOCK_DAYS = 7` — constante única. `push-dispatch.server.ts` importa esto para
  `RENEWAL_DAYS_LEFT`.
- `isNextMonthUnlocked(today: "YYYY-MM-DD"): boolean` → `daysLeftInMonth(today) <= NEXT_MONTH_UNLOCK_DAYS`.
- `planMonthStatus(month, today): "past" | "current" | "next-locked" | "next-unlocked" | "far-future"`.
- `isMonthActionable(month, today): boolean` → status `current` o `next-unlocked`.
- `planNavBounds(today, appStartedOn: string | null): { earliest: "YYYY-MM"; latest: "YYYY-MM" }`
  - `latest` = `isNextMonthUnlocked(today) ? nextMonthISO(today) : currentMonth`
  - `earliest` = `min(currentMonth, monthOf(appStartedOn ?? today))` — el mes de la fecha de
    alta es el suelo. (No hace falta escanear los meses con datos: nunca hay plan ni log antes
    del alta.)
- `isBeforeAppStart(dateISO, appStartedOn): boolean` — para pintar los días previos al alta
  (dentro de su propio mes) como inertes.

### 3.2 Capa de datos — `src/lib/daily.ts` (+ `mobile/lib/daily.ts`)

- El límite del `‹` sale de `profiles.app_started_on` (3.0), **no** de escanear
  `monthly_plans` — no hace falta un `fetchPlanMonths`. Si un mes pasado no tiene fila en
  `monthly_plans`, `planQ.data` es `null` y se muestra el estado vacío correspondiente (§3.6).
- `fetchLogsForMonth(month: "YYYY-MM"): Promise<DailyLog[]>` —
  `.gte("log_date", month+"-01").lte("log_date", finDeMes)`. Query key `["logs", month]`.
  El calendario del mes seleccionado usa esto. El `fetchLogs()` global (límite 120,
  ~4 meses) se queda para `impulso` / `WeightTrend` / objetivo, que son transversales.
- **Extraer** `sumDoneMacros`, `ZERO_MACROS`, `macroTargets` de `hoy.tsx` a
  **`src/lib/macros.ts`** (sin React) — lo usan Hoy y el nuevo detalle de día. Copia en
  `mobile/lib/macros.ts`.

### 3.3 Componente compartido — `src/components/macro-bars.tsx`

- **Extraer** `MacroBars` de `hoy.tsx` tal cual; `hoy.tsx` lo importa. Lo reusa el detalle de
  día. En mobile, comprobar dónde vive hoy su `MacroBars` (mobile `hoy.tsx`) y extraer igual.

### 3.4 `PlanMonthCalendar` — `src/components/plan-month-calendar.tsx` (web) + inline en `mobile/app/(app)/plan.tsx`

Props nuevas: `logs: DailyLog[]` (del mes seleccionado), `monthStatus`, `onOpenDay(date)`.

Render por celda:

- `date === today` → anillo primario (como ahora).
- `date < today` (día pasado, mes en curso o pasado) → fondo/punto por
  `ratioSignal(hechas, total)` del log de ese día; gris apagado si hay log sin comidas
  hechas, neutro (`none`) si no hay log. Tocar → `onOpenDay(date)`.
- `date > today` en el mes en curso, o cualquier día de un mes futuro desbloqueado → neutro;
  tocar → diálogo "menú del día" existente (`mealsForDate`).
- `beforeStart` (plan a media de mes) → se mantiene apagado y no abrible, **salvo** que haya
  log de ese día (entonces sí muestra semáforo y abre el detalle).
- Mes entero pasado → todos los días son "pasado": semáforo donde haya log, `none` si no.
- Actualizar la leyenda con la explicación del semáforo (reutilizar el texto que hoy tiene
  `AdherenceHeatmap`: "Verde: todas las comidas. Amarillo: comiste algo. Gris: sin comidas.").
- El diálogo "menú del día" para hoy/futuro se mantiene.

### 3.5 Componente nuevo — `src/components/day-detail-sheet.tsx` (web) + equivalente mobile

Props: `date`, `plan`, `log` (de `["logs", month]`), `profile`, `onClose`.
Contenido, en orden:

1. Cabecera: día de la semana + fecha (capitalize).
2. **Comidas** — por cada comida de `mealsForDate(plan, date)` cruzada con `log.habits` por
   `label`:
   - `status === "plan"` → plato, tinte verde, "Comiste lo del plan".
   - `status === "distinto"` + `habit.wasIdea` (y `wasIdea !== idea`) → plato real (lo que se
     comió) en primary + `wasIdea` tachado debajo, etiqueta "Plan sugerido".
   - `status === "distinto"` sin `wasIdea` → plato planificado + "Comiste otra cosa".
   - `status === "salteo"` → plato planificado tachado, apagado, "Te lo saltaste".
   - `status == null` (día nunca cerrado) → plato planificado, apagado, "Sin registrar".
   - Línea resumen: "X de Y comidas · N saltadas".
3. **Macros del día** —
   `<MacroBars estimate={sumDoneMacros(log.guide?.mealMacros, log.habits) ?? ZERO_MACROS}
target={log.guide?.macroEstimate ?? null} weightKg={profile?.current_weight_kg} />`.
   Si `log?.guide == null` → "No hay estimación de macros para este día".
4. **Corrección retroactiva** (solo si `date < today`): los chips `MEAL_STATUS_LABEL` por
   comida → `updateLogByDate(date, { habits })`, con la nota "solo afecta a tu historial: la
   compra ya hecha de ese mes no cambia". Invalida `["logs"]` y `["logs", month]`.

- **Nada** de `DishRecipe`, mensajes del coach ni `guide.intro`/`tips`.

### 3.6 `src/routes/_authenticated/plan.tsx` (web) + `mobile/app/(app)/plan.tsx`

- `validateSearch`: `tab?: "plan" | "compra"` (quitar `"historial"`); **añadir**
  `month?: "YYYY-MM"` (validar forma) para deep-links / el push de renovación.
- Estado: `const [selectedMonth, setSelectedMonth] = useState(searchMonth ?? monthISO())`.
  Sustituir **todos** los usos de `month` por `selectedMonth`: query keys
  `["plan", selectedMonth]` y payloads de `generate`, `recadence`, `owned`, `setActual`,
  `confirmTrip`.
- Cabecera: el título se vuelve navegador de mes — `‹` · `Mes Año` · `›`.
  `bounds = planNavBounds(todayISO(), profile?.app_started_on ?? null)`.
  - `‹` deshabilitado en `bounds.earliest` (= mes de la fecha de alta).
  - `›` deshabilitado en `bounds.latest`. Si el destino sería el mes siguiente aún
    bloqueado (`next-locked`), mostrar candado + texto/toast: "Podrás preparar {mes} a partir
    del {fecha}".
- Derivar `monthStatus = planMonthStatus(selectedMonth, todayISO())` y
  `actionable = isMonthActionable(selectedMonth, todayISO())`.
- Botón regenerar (`RefreshCw`): solo si `plan && actionable`.
- Píldora de subpestañas: 2 (Plan, Ingredientes). Quitar la rama `tab === "historial"`.
- **Subpestaña Plan** (orden nuevo): `<GoalWeightSummary logs={globalLogs} profile />` →
  tarjeta intro (existente, ocultarla si no hay `plan`) →
  `<PlanMonthCalendar plan month={selectedMonth} logs={monthLogs} monthStatus onOpenDay />`
  → `<DayDetailSheet>` cuando hay `openDay`.
  - `GoalWeightSummary` es transversal (objetivo/peso no dependen del mes) → se muestra
    siempre, con los logs globales.
- **Subpestaña Ingredientes**, según `monthStatus`:
  - `past` → `IngredientsTab` en **solo lectura**: sin tap-para-marcar, sin CTA "Ir a
    comprar", sin cambio de cadencia, sin campo de gasto, sin entrada a Modo compra. (El
    `IngredientsTab` ya calcula `editable = timing === "current"` por compra → en un mes
    pasado todas son "past" y quedan no editables; falta ocultar CTA + cadencia + Modo
    compra.) Nota de cabecera: "Compra de {mes} — solo lectura".
  - `next-unlocked` → plenamente accionable. **Override**: tratar todas las compras como
    `current` (el usuario hace toda la compra pre-mes ahora) — pasar un flag
    `allTripsCurrent` o calcular `effectiveTiming`. Documentar como simplificación
    deliberada.
  - `next-locked` / `far-future` → inalcanzables (el `›` para antes).
  - Vacío en `next-unlocked` sin plan → "Prepara tu plan de {mes} para comprar antes de que
    empiece" + "Crear plan de {mes}".
- Estado `!plan`:
  - `current` → "Crear plan del mes" (existente).
  - `past` con logs → mostrar la subpestaña Plan con `GoalWeightSummary` + calendario (sin
    tarjeta intro). El "no hay plan" a pantalla completa solo aplica al mes en curso.
  - `past` sin nada (mes ≥ alta pero sin plan ni logs) → "No planificaste {mes}".
  - `next-unlocked` → CTA "Crear plan de {mes}".
- **Días previos a la fecha de alta** (`isBeforeAppStart(date, profile.app_started_on)`): en
  el calendario salen inertes (mismo tratamiento que `beforeStart` de cobertura parcial) y su
  detalle, si se abre, dice "Antes de empezar a usar Peppers" en vez de "Sin registrar". El
  mes de la fecha de alta es además el suelo de `‹`, así que meses enteros anteriores no son
  alcanzables.
- `shopMode` (pantalla completa): sin cambios, solo alcanzable si `actionable`.
- Actualizar el comentario de `bottom-nav.tsx` ("Historial ... tercera sub-pestaña").

### 3.7 Redirects — `src/routes/_authenticated/historial.tsx` + `mobile/app/(app)/historial.tsx`

- Cambiar destino `/plan?tab=historial` → `/plan` (sin search). Mantener el archivo (enlaces
  y notificaciones antiguas).
- `src/routeTree.gen.ts` se regenera solo con `bun run dev`; no se toca a mano.

### 3.8 `src/components/historial-section.tsx` + `mobile/components/historial-section.tsx`

- **Extraer** el bloque `ProgressBar` del objetivo + `WeightTrend` a
  `<GoalWeightSummary>` (archivo propio o co-ubicado). Mover `formatMetaDate` con él.
- **Fundir** la lista de comidas de `DayRow` + su corrección inline en `<DayDetailSheet>`.
- **Borrar** `AdherenceHeatmap`.
- **Borrar** `historial-section.tsx` (las dos copias) cuando nadie lo importe. Revisar el
  helper `iso` por si lo usa alguien más.

### 3.9 `src/lib/plan.functions.ts` — barrera en `generateMonthlyPlan` (Punto 4 + 6)

Dentro de `.validator(...)`:

```ts
const today = madridTodayISO();
const currentMonth = today.slice(0, 7);
if (input.month < currentMonth) throw new Error("No se planifican meses pasados");
const nm = nextMonthISO(today);
if (input.month > nm) throw new Error("Solo puedes preparar hasta el mes que viene");
if (input.month === nm && !isNextMonthUnlocked(today)) {
  throw new Error("Aún no toca preparar el mes que viene; podrás la última semana del mes");
}
```

- Protege también `/api/v1/plan/generate` (misma server fn). Los mensajes se muestran en
  pantalla (convención "500 con `error`", ver AGENTS.md).
- `input.month < currentMonth` ya cubre todo lo anterior a la fecha de alta (que nunca es
  posterior al mes en curso); la fecha de alta actúa en la UI (suelo del `‹`, §3.6), no aquí.
- `monthCoverage(month, today)` ya da `fromDay = díaDeHoy` para el mes en curso y `fromDay = 1`
  para uno futuro — la cobertura parcial (intención real de "solo desde hoy") ya funciona;
  esta barrera solo añade el bloqueo de pasado / futuro lejano.
- La autogeneración de `hoy.tsx` usa `monthISO()` (mes en curso) → no le afecta.

### 3.10 `src/lib/household.server.ts` — `syncSharedMeals` para mes futuro

Cuando `opts.month > opts.today.slice(0,7)` (se prepara el mes que viene por adelantado), usar
un cursor "nada fijado todavía" para que se sincronice el mes entero:

```ts
const cursor =
  opts.month > opts.today.slice(0, 7)
    ? { weekIndex: -1, dayIndex: -1, dayName: "" }
    : planCursor(opts.today);
```

Si no, `planCursor("2026-08-26")` marca las semanas 0-2 de septiembre como "pasadas" y las
comidas compartidas del hogar nunca se propagan al plan del mes que viene.

### 3.11 `src/lib/push-dispatch.server.ts`

- `RENEWAL_DAYS_LEFT` = `NEXT_MONTH_UNLOCK_DAYS` (7). Actualizar el comentario ("A 7 días…").
- Importar `daysLeftInMonth` / `nextMonthISO` de `plan-shared` (borrar copias locales).
- `renewalCopy`: cambiar el `url` del push de `/hoy` a `/plan?month=${nextMonth}` para que el
  CTA lleve a la pantalla del plan del mes que viene (requiere el search param `month` de 3.6).

### 3.12 Tests — `src/lib/plan-shared.test.ts`

`addMonths`; `isNextMonthUnlocked` (borde: 8 días restantes = bloqueado, 7 = desbloqueado);
`planMonthStatus` para los cinco estados; `planNavBounds` (earliest con `app_started_on` y con
`null`; latest bloqueado vs desbloqueado); `isBeforeAppStart`.

### 3.13 Docs

- `CLAUDE.md`: quitar "No hay suite de tests" (ya la hay: `bun test`); actualizar la
  descripción de la pantalla Plan (2 subpestañas, navegación de meses).
- `AGENTS.md`: nota corta sobre la navegación de meses y la barrera de `generateMonthlyPlan`.
- Memoria nueva si el feature se mergea (no ahora): "Plan: navegación de meses y unificación
  de Historial".

---

## 4. Paridad mobile (hacer mobile PRIMERO y verificar en simulador — memoria `native-ios-app`)

Cada cambio tiene gemelo:

- `mobile/lib/plan-shared.ts`, `mobile/lib/daily.ts`, `mobile/lib/macros.ts` — mismos helpers/queries.
- `mobile/app/(app)/plan.tsx` — navegador de mes, 2 subpestañas, props del calendario
  (inline), detalle de día (sheet/Dialog RN), Ingredientes solo lectura en mes pasado.
- `mobile/components/historial-section.tsx` — misma extracción/borrado; `GoalWeightSummary` RN.
- `mobile/app/(app)/historial.tsx` — redirect a `/plan`.
- Comprobar dónde vive `MacroBars` en `mobile/app/(app)/hoy.tsx` y extraer igual.
- `mobile/lib/daily.ts` (`Profile` + `app_started_on`), onboarding de `mobile/` y
  `mobile/lib/demo-profile.ts` — igual que en web (§3.0).
- La barrera de `generateMonthlyPlan` es de servidor → mobile la hereda por
  `/api/v1/plan/generate`.

---

## 5. Matriz de QA

| Escenario                    | Esperado                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usuario nuevo a media de mes | Plan del mes en curso cubre hoy→fin de mes; días previos a la fecha de alta = "Antes de empezar a usar Peppers" (inertes); `‹` no baja del mes de alta; `›` bloqueado si faltan >7 días.       |
| Alta a mitad de mes anterior | `app_started_on` = ese día; `‹` llega hasta ese mes y para; días de ese mes anteriores al alta salen inertes, los posteriores con semáforo.                                                    |
| Última semana del mes        | `›` desbloquea el mes que viene; se puede generar; Ingredientes del mes que viene plenamente accionable (**todas** las compras a la vez); se puede hacer la compra; el push a 7 días coincide. |
| Mes con historial            | Mes pasado → calendario con semáforos; el detalle de día abre; la corrección funciona; Ingredientes solo lectura; sin botón de regenerar.                                                      |
| Usuario existente (backfill) | `app_started_on` = `created_at::date`; navegación coherente sin que el usuario haya hecho nada.                                                                                                |
| Deep links                   | `/historial` → `/plan`; `/plan?month=2026-09` abre septiembre si está permitido, si no lo recorta a `bounds`.                                                                                  |
| Hogar                        | Generar el mes que viene por adelantado → los planes del mes que viene de los demás miembros reciben las comidas compartidas (fix del cursor).                                                 |
| Coach                        | Sigue apuntando al mes en curso (`use-coach-actions.ts` sin cambios) — límite de alcance conocido.                                                                                             |
| Regresión Hoy                | `MacroBars` extraído se sigue viendo igual en Hoy; `sumDoneMacros` idéntico.                                                                                                                   |

---

## 6. Preguntas abiertas — RESUELTAS (2026-08-31)

1. **Fecha de alta (D7).** ✅ Sí — `profiles.app_started_on`, fijada al completar el
   onboarding, backfill con `created_at::date`. Es el suelo de la navegación y marca los días
   previos como "antes de empezar". Detalle en §3.0 / §3.6.
2. **`GoalWeightSummary` fuera del mes actual.** ✅ Se muestra siempre, con datos globales (D8).
3. **Compras parciales del mes que viene.** ✅ Todas las compras accionables a la vez cuando
   el mes+1 se desbloquea; sin escalonado semana a semana (D9).

Ninguna pregunta abierta pendiente.

---

## 7. Tickets

Ver `issues/`:

- `01-shared-helpers.md` — helpers de mes + consolidación de constantes + tests.
- `02-server-guards.md` — migración `app_started_on` + onboarding + barrera `generateMonthlyPlan` + fix `syncSharedMeals` + push a 7.
- `03-data-and-macros.md` — `fetchLogsForMonth`, extraer `macros.ts` + `<MacroBars>`.
- `04-goal-summary-and-day-detail.md` — `<GoalWeightSummary>` + `<DayDetailSheet>`.
- `05-calendar-semaphores.md` — semáforo por día en `PlanMonthCalendar` + apertura de día.
- `06-plan-screen-month-nav.md` — navegador de mes + reestructura a 2 subpestañas + gating de Ingredientes.
- `07-cleanup-and-redirects.md` — borrar `historial-section` / `AdherenceHeatmap`, repuntar redirects, docs.
- `08-qa-and-simulator.md` — matriz de QA + verificación en simulador iOS.

Orden sugerido: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08. Dentro de 04-06, mobile antes que web.
