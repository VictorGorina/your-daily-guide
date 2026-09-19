# Spec — Hoy: añadir picoteo

Status: implementado y verificado en simulador iOS y navegador (2026-09-16), sin commit todavía
Feature slug: `picoteo-hoy`
Relacionada con: `.scratch/hoy-semanas-editables/` (adelanta la regla pura del ticket 08).

## Contexto

Hoy no hay forma de apuntar un picoteo entre horas con datos. Lo más parecido es "Registrar deporte"
o el modo "exceso" del `GuidedLogSheet`: los dos componen un texto, lo mandan al chat, y el coach
decide a ojo si llama a `ajustar_plan_mensual` y con cuántas kcal. No queda nada guardado en el
historial, y es el modelo quien decide si hay que compensar. Eso va contra dos reglas ya aprobadas:
la precisión de las kcal es la base de la app, y el modelo nunca decide si se compensa.

Resultado buscado:

- Un botón **"Añadir picoteo"** encima de "Registrar deporte" (web y móvil).
- La app calcula las kcal en código con la tabla de composición y enseña la cifra antes de guardar.
  La persona puede corregirla, por ejemplo con lo que pone el envase.
- El picoteo se guarda en el registro del día, suma en la barra de macros y aparece en el
  historial (el detalle del día pasado, en Hoy y en Plan).
- Si los picoteos del día que aún no se han compensado superan la **tabla de umbrales aprobada**,
  se recolocan comidas y cenas de los próximos días. Hoy, el pasado y la compra no cambian.

Decisiones del usuario (2026-09-16):
- **Límite = tabla de umbrales** de `hoy-semanas-editables` (perder ≥ +200, mantener ≥ +200,
  ganar ≥ +400), **acumulada** con los picoteos del día que aún no se han compensado.
- **Kcal = calcular y confirmar**: texto o dictado + chips → "Calcular" → "≈ 175 kcal · 6 g prot"
  editable → "Guardar picoteo".

Decisiones que tomo yo (siguen reglas ya fijadas):
- **Un campo propio `daily_logs.snacks`**, no dentro de `habits`. `reconcileHabits` reconstruye
  `habits` desde el plan en cada carga y borraría el picoteo. Además, así el semáforo de
  cumplimiento y el "impulso" no cambian: un picoteo no cuenta como fallo.
- **El picoteo solo compensa en las comidas propias.** En un hogar, ni quien planifica cambia la
  cena de toda la familia por su picoteo. Es la regla de hogar ya aprobada: un desvío personal se
  corrige en las comidas no compartidas de esa persona.
- **Embarazo o lactancia: nunca se compensa a la baja.** El picoteo se registra, pero no se quitan
  kcal a días futuros. Nota: el ticket 08 dice "con Δkcal < 0 nunca compensa quitando", que parece
  al revés. Lo corrijo allí al cerrar.
- **Se adelanta solo la regla pura del ticket 08** (`compensationNeed` + `COMPENSATION_THRESHOLDS`).
  Es su primer uso. El lote de cambios de plato del ticket 08 sigue pendiente y reutilizará la
  misma regla.
- **Solo hoy.** Se añade y se borra picoteo del día de hoy. En días pasados el historial solo lo
  enseña.

## Diseño

### 1. Datos — migración `supabase/migrations/2026091612xxxx_daily_logs_snacks.sql`

`ALTER TABLE public.daily_logs ADD COLUMN snacks jsonb;` (NULL = sin picoteo). No hacen falta
policies nuevas: la fila ya está cubierta por "insert recent own log" y "update own logs". Hay que
aplicar la migración en el proyecto Supabase.

Tipos (en `src/lib/snacks.ts` y su copia `mobile/lib/snacks.ts`; `DailyLog.snacks?: DaySnacks | null`
en `src/lib/daily.ts` y `mobile/lib/daily.ts`):

```ts
type SnackEntry = {
  id: string; text: string; at: string;            // at = ISO timestamp
  kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number;
  source: "lookup" | "manual";                      // manual = la persona corrigió la cifra
};
type DaySnacks = {
  entries: SnackEntry[];
  compensatedKcal: number;                          // kcal ya enviadas a compensar (con signo)
  adjustment?: { changes: MealChange[]; summary: string; kcal: number } | null;
  lastOutcome?: "adjusted" | "below-threshold" | "no-days" | "pregnancy" | "shared-only" | null;
};
```

`compensatedKcal` funciona como un libro de cuentas. Lo pendiente es `Σ kcal − compensatedKcal`.
Así:
- dos picoteos de 150 kcal suman 300 → superan +200 → se compensan 300;
- borrar un picoteo ya compensado deja un pendiente negativo, que se repone si supera el umbral
  negativo del objetivo (−400 al perder, −200 al mantener o ganar);
- volver a asentar el mismo día nunca compensa dos veces.

### 2. Lógica pura (con tests, runner de Bun)

- `src/lib/nutrition/compensation.ts` (+ `.test.ts`): `COMPENSATION_THRESHOLDS` y
  `compensationNeed({ deltaKcal, deltaProtein, goal, pregnancyStatus })`, exactamente como en
  `.scratch/hoy-semanas-editables/issues/08-nucleo-de-compensacion.md`. Hay que reexportarlo desde
  `nutrition/index.ts` (es puro). `goal` sale de `deriveGoalType` (`src/lib/daily.ts:557`) o del
  objetivo legacy (`normalizeGoalType`), igual que `reflowMeals`.
- `src/lib/snacks.ts` (+ test): `snackTotals`, `pendingSnackKcal`, `withSnack`, `withoutSnack`,
  `snackNote(entries)` (el texto para la IA). Una copia en `mobile/lib/snacks.ts`.
- `src/lib/macros.ts`: `addMacros(a, b)`. En Hoy y en `DayDetailBody`, lo consumido pasa a ser
  `addMacros(sumDoneMacros(...) ?? ZERO_MACROS, snackTotals(log.snacks))`. Mismo cambio en
  `mobile/lib/macros.ts`.
- `src/lib/plan-shared.ts`: `compensationWindow(month, today, sharedSlots, isPlanner)`. Devuelve
  las fechas de mañana a hoy + 6, dentro del mes, que tengan al menos una comida o cena **no
  compartida** (`isSharedSlot`). Esa misma ventana la necesitará el ticket 08.

### 3. Tabla de composición — alimentos de picoteo que faltan

`src/lib/nutrition/foods.data.ts` no tiene cerveza, vino, galletas, bollería, helado, patatas
fritas de bolsa (solo "patata frita casera", 190 kcal/100 g, frente a unas 530 de las de bolsa),
aceitunas, palomitas, pipas ni refresco. Sin ellos, el picoteo típico cae en `GENERIC_FOOD`. Hay
que añadir unas 12–15 filas con valores de USDA FoodData Central / CIQUAL (fuente aprobada en
`precision-nutricional`), con `densityGPerMl` para las bebidas. También hay que separar el alias
"patatas fritas de bolsa" / "chips" de la fila casera.

Tests en `nutrition.test.ts` para que `matchFood` case cada alimento nuevo, y un caso en
`bun run eval:dishes` con frases de picoteo.

`resolve-dish.server.ts`: añadir anclas de picoteo a `RATION_ANCHORS` (puñado de frutos secos
≈ 30 g, galleta ≈ 10 g, onza de chocolate ≈ 10 g, bolsa pequeña de patatas ≈ 40 g, caña ≈ 200 ml,
copa de vino ≈ 150 ml).

### 4. Servidor — `src/lib/snacks.functions.ts` + rutas espejo `src/routes/api/v1/snacks/*`

Todas usan `requireSupabaseAuth` y `today` validado (patrón de `adjustMonthlyPlan`). Cada una tiene
su ruta de 3 líneas con `apiPost` (`estimate.ts`, `log.ts`, `remove.ts`, `settle.ts`).

- **`estimateSnack({ text })`**: nueva cuota `snack-estimate` en `RATE_LIMITS`, y
  `dishToIngredients(text, { servings: 1, userId })`. Devuelve las macros por ración y
  `resolved`, con el mismo criterio de "usable" que `macrosFromLookup` en `guide.functions.ts`.
  Si no se resuelve, **no inventa**: la hoja pide las kcal a mano (nada de `roughMealMacros`).
- **`logSnack({ today, text, macros, source })`**: valida (texto de 2 a 120 caracteres, kcal de 0
  a 3000, fecha = hoy), relee la fila y añade la entrada. Si no existe la fila de hoy, la crea con
  un upsert sobre `(user_id, log_date)` que solo escribe `snacks`. Solo escribe la columna
  `snacks`, así que no choca con las escrituras de `habits` del cliente.
- **`removeSnack({ today, id })`**: solo hoy.
- **`settleSnacks({ today })`**: la compensación. El servidor es la fuente de verdad; el cliente
  solo avisa de que hay algo que asentar.
  1. Lee `snacks` y el perfil. Calcula `pending = pendingSnackKcal(...)`.
  2. Llama a `compensationNeed`. Si devuelve `null`, guarda `lastOutcome` (`below-threshold` o
     `pregnancy`) y termina, **sin llamar a la IA**.
  3. Calcula `compensationWindow`. Si queda vacía, guarda `no-days` o `shared-only` y termina.
  4. Aplica la cuota `plan-adjust`. **Reserva** el pendiente: escribe
     `compensatedKcal += pending` antes de llamar a la IA, para que otro asentamiento en paralelo
     no compense lo mismo. Si falla, lo devuelve.
  5. Lee el plan de antes y llama a `reflowMeals({ kcalDelta: pending, note: snackNote(...),
     window, soloOnly: true })`. Calcula `diffFutureMeals(antes, después, today)` y guarda
     `adjustment` y `lastOutcome: "adjusted"`.
- **`reflowMeals`** (`src/lib/plan.functions.ts:1218`), cambios pequeños y compatibles:
  - `window?: string[]`: sustituye a `editableDates` cuando viene.
  - `soloOnly?: boolean`: añade la REGLA 5 al prompt también para quien planifica, restaura las
    comidas compartidas con `composeMonthlyPlanForMember(merged, current, home.sharedSlots)`
    (el mismo cinturón que ya se usa para un no planificador) y no llama a `syncSharedMeals`.
  - La lectura de "Últimos días reales" (`:1241`) añade `snacks`, para que la IA vea el contexto.

### 5. Cliente — asentamiento con debounce

`src/lib/snack-settle.ts` y `mobile/lib/snack-settle.ts`, con la misma forma que `plan-recalc.ts`:
- `scheduleSnackSettle(today)`: 10 s de calma, así que tres picoteos seguidos son **una**
  llamada.
- La marca de "pendiente" se guarda en `localStorage` / `AsyncStorage`.
- Se fuerza al ocultar la app (`visibilitychange` / `AppState`) y se relanza al montar Hoy.
- Solo hay un asentamiento en vuelo a la vez. El cuerpo es solo `{ today }`.
- Al terminar, invalida `["today"]`, `["logs"]` y `["plan"]`.
- `useSnackSettle()` expone `isPending` e `isRunning` para el spinner.

### 6. UI (móvil primero, luego web; tokens de `docs/design-guidelines.md`)

- **Botón** "Añadir picoteo" con el icono `Cookie` (`lucide-react-native` / `lucide-react`),
  justo encima de "Registrar deporte" y con el mismo estilo de píldora `bg-surface`:
  - web: `src/routes/_authenticated/hoy.tsx:880`;
  - móvil: `mobile/app/(app)/hoy.tsx:857`.
- **`SnackSheet`** (`src/components/snack-sheet.tsx`, `mobile/components/snack-sheet.tsx`):
  - chips (Frutos secos, Galletas, Chocolate, Patatas fritas, Cerveza, Vino, Fruta, Queso), un
    textarea y `DictateButton`;
  - "Calcular" → "≈ 175 kcal · 6 g prot" con un botón de editar kcal. Al editar, las demás macros
    se escalan en proporción y `source` pasa a `manual`;
  - si cambia el texto, la cifra calculada se borra;
  - si no se resuelve: "No he podido calcularlo. ¿Cuántas kcal son? (lo pone el envase)";
  - "Guardar picoteo" → `logSnack` → se cierra la hoja → `scheduleSnackSettle`.
  - Móvil no tiene toasts: los errores van inline en la hoja o con `Alert.alert`.
- **Lista "Picoteo de hoy"** bajo el botón, solo si hay entradas. Cada fila lleva texto, kcal y una
  X para borrar. Debajo va una línea de estado:
  - "Ajustando el plan…" (`Loader2`) mientras se asienta;
  - "He ajustado N comidas para compensarlo · Ver" → `AdjustmentInfoSheet`, que ya existe en las
    dos plataformas;
  - "No quedan días este mes para compensarlo" o "Tus comidas de estos días son compartidas; no
    las cambio por un picoteo";
  - si está por debajo del umbral, no se enseña nada: el picoteo solo suma.
- **Barra de macros**: suma lo consumido más el picoteo. La frase "~X kcal de lo que llevas comido
  hoy" ya lo refleja sola.

### 7. Historial

`DayDetailBody` (`src/components/day-detail-sheet.tsx` y
`mobile/components/day-detail-sheet.tsx`) lo usan la tira de Hoy y el calendario de Plan:
- una sección "Picoteo", con texto y kcal, después de "Comidas";
- la línea de `adjustment.summary`, si la hay;
- lo consumido incluye `snackTotals`;
- solo lectura (el día ya pasó);
- el semáforo (`ratioSignal`) no cambia.

Si hoy hay picoteo pero ninguna comida registrada, la sección aparece igualmente, en vez del texto
"No registraste ninguna comida".

## Orden de trabajo

0. Escribir `.scratch/picoteo-hoy/spec.md` (convención del issue tracker) con estas decisiones.
   Añadir una nota en el ticket 08 de `hoy-semanas-editables`: `compensationNeed` ya existe, y el
   texto sobre embarazo está al revés.
1. Lógica pura y tests: `compensation.ts`, `snacks.ts`, `addMacros`, `compensationWindow`.
2. Filas nuevas en la tabla de composición, anclas y tests de `matchFood`.
3. Migración y tipos en web y móvil.
4. Servidor: `snacks.functions.ts`, los cambios de `reflowMeals`, las 4 rutas `/api/v1/snacks/*` y
   la cuota `snack-estimate`.
5. **Móvil**: `snack-settle`, `SnackSheet`, botón, lista, barra e historial. Verificar en el
   simulador.
6. **Web**: lo mismo. Verificar en el navegador.
7. Documentación: sección "Picoteo en Hoy" en CLAUDE.md y AGENTS.md; tabla de tests en
   `docs/agents/testing.md`.

## Verificación

- `bun run lint`, `bun run typecheck`, `bun run test` y `bun run format`.
- `bun run eval:dishes` con las frases de picoteo nuevas (gasta llamadas: solo una pasada).
- **Simulador iOS y después el navegador, siempre con el perfil demo** ("Probar con un perfil
  aleatorio"):
  1. "una bolsa de patatas fritas y una cerveza" → Calcular → unas 400–500 kcal → Guardar. Tras
     unos 10 s aparece "He ajustado N comidas". Los cambios caen entre mañana y hoy + 6. Hoy, los
     días pasados y la compra no cambian (se compara la fila `monthly_plans.shopping` antes y
     después).
  2. "una manzana" (unas 80 kcal) → se guarda y suma en la barra, y en las peticiones de red **no**
     aparece ninguna llamada de reajuste (`/snacks/settle` responde `below-threshold`).
  3. Dos picoteos de unas 120 kcal seguidos → **un** solo asentamiento, que compensa unas 240.
  4. Borrar el picoteo del caso 1 ya compensado → pendiente negativo → se repone si supera el
     umbral negativo del objetivo del perfil demo.
  5. Texto sin sentido → "No he podido calcularlo" → kcal a mano → se guarda con
     `source: manual`.
  6. Cerrar la app dentro de los 10 s y volver a Hoy → el asentamiento se manda.
  7. Día pasado en la tira (hay que mover el `log_date` de la fila demo con la API REST) → se ve
     la sección "Picoteo" y cuenta en las macros.
  8. Hogar con comidas compartidas (perfil demo como planificador) → las cenas compartidas no
     cambian y solo se mueven las comidas propias.

## Fuera de alcance

- Añadir picoteo a un día pasado (encaja con los tickets 05, 06 y 11 de la tira).
- El lote de cambios de plato del ticket 08 (solo se adelanta su regla pura).
- Ocultar las cifras según `showsNutritionNumbers` (`precision-nutricional/01`, aún no hecho).
  Cuando llegue, esa preferencia tendrá que cubrir también la hoja y la lista de picoteo.
- Cambiar el chip "Picoteo entre horas" del registro guiado del chat: sigue siendo el camino del
  coach para "picoteo sin detalle" (invariante 8 de la spec).

## Comments

### 2026-09-16 — verificación

- Migración `20260916120000_daily_logs_snacks.sql` aplicada a mano en el SQL Editor.
- Simulador (perfil demo planificador, objetivo mantener): 520 kcal con todas las comidas y cenas
  compartidas → `shared-only`, sin llamada a la IA; con las cenas de jueves y viernes propias,
  606 kcal → `adjusted`, solo cambian esas dos cenas; borrar la bolsa ya compensada (−520) →
  devuelve energía, `compensatedKcal` 86; historial del día pasado con sección "Picoteo".
- Navegador (perfil demo en solitario): fruta 78 kcal → `below-threshold`; acumulado 165 →
  `below-threshold`; 506 → `adjusted` (2 cenas); texto sin sentido → kcal a mano (`manual`);
  recargar dentro de la ventana → el asentamiento se relanza. En todos los casos la compra, hoy y
  el pasado quedan idénticos (diff del JSON de `monthly_plans`).
- Encontrado y corregido durante la verificación: la hoja móvil no subía con el teclado (arreglado
  en `ui/sheet.tsx`, afecta a todas las hojas); "Dictar" tapaba el texto en web; "onza" de
  chocolate se leía como onza inglesa (ancla nueva en el prompt); un reajuste sin cambios se daba
  por compensado (ahora devuelve la reserva y cuenta como fallo); `composeDayForUser` reordenaba
  `kids` y reescribía días pasados sin cambiarlos.
- Abierto: `reflowMeals` puede sustituir una "Cena fuera" por un plato de casa (fallo previo, tarea
  aparte). En un hogar con todas las comidas y cenas compartidas el picoteo nunca reajusta — es la
  regla de hogar aprobada, pero conviene confirmarlo con el usuario (p. ej. una persona adulta sola
  con peques).

### 2026-09-17 — asimetría al deshacer un picoteo

Reportado por el usuario: con objetivo "perder", un picoteo de +200 kcal (justo el umbral de
exceso) sí recolocaba el plan, pero borrarlo después (pendiente −200) no lo revertía, porque el
umbral de déficit de "perder" es −400. La compensación quedaba pisada sin motivo: no había ningún
picoteo real que justificara el desvío. La asimetría de la tabla (línea 76 de este documento) tiene
sentido para un déficit genuino, pero no para deshacer un ajuste que la propia app aplicó. Arreglado
con `compensationNeed({ reversing: true })`: al deshacer, compara con el umbral de exceso (`above`),
el mismo que hizo falta para aplicar la compensación, en vez del de déficit (`below`).

### 2026-09-19 — editar picoteo de un día pasado

Cierra el punto de "Fuera de alcance" de arriba ("Añadir picoteo a un día pasado"), sin esperar a
los tickets 05/06/11 de `hoy-semanas-editables` (esos siguen pendientes para corregir comidas). La
sección "Picoteo" de `DayDetailBody` (web y móvil) deja de ser de solo lectura: enseña una X para
quitar cada entrada y un botón "Añadir picoteo" que abre `SnackSheet` con la fecha de ese día. Los
dos sitios que usan `DayDetailBody` (el calendario de Plan y la tira de Hoy dentro de la semana) lo
heredan gratis.

Deliberadamente **no** pasa por `settleSnacks`/`scheduleSnackSettle`: ese asentamiento recoloca
comidas y cenas de los días siguientes a HOY (ver `resumeSnackSettle` en `snack-settle.ts`, que ya
descartaba a propósito un pendiente de otro día), y un día pasado no tiene "días siguientes a él
mismo" que tenga sentido tocar. Editar picoteo de un día pasado es solo corregir el historial de
ese día — igual que corregir una comida con `updateLogByDate` no mueve kcal (H2 de
`hoy-semanas-editables`). `logSnack`/`removeSnack` ya aceptaban cualquier fecha (nunca estuvieron
atados a "hoy" en el servidor); el cambio es solo de UI. `SnackSheet` gana un prop `pastDay` que
cambia el copy ("Es solo para tu historial: no cambia el plan ni la compra.") para no prometer un
reajuste que no va a pasar.

Verificado en el navegador con el perfil demo: añadir y quitar un picoteo en un día pasado desde
Plan y desde Hoy, en los dos casos las macros del día se actualizan al momento y ninguna llamada de
red toca `/snacks/settle` ni cambia el plan.

