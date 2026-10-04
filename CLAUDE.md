# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Este repositorio contiene dos apps que comparten el mismo backend de Supabase pero **no** son un
monorepo (no hay `packages/shared/`, cada una instala sus propias dependencias):

- **Web** (raíz, `src/`): la app principal. TanStack Start + React + TypeScript + Tailwind v4,
  gestionada con **Bun**.
- **Móvil** (`mobile/`): app nativa de iOS en Expo/React Native, gestionada con **npm** (Metro no
  corre sobre Bun). Tiene su propio [mobile/AGENTS.md](mobile/AGENTS.md) — léelo antes de tocar
  código ahí.

Este archivo cubre sobre todo la web. Para la arquitectura en detalle (con el porqué de cada
decisión), lee también [AGENTS.md](AGENTS.md) en la raíz — este CLAUDE.md resume lo esencial, pero
AGENTS.md tiene la explicación larga de varias piezas no obvias.

## Comandos (web, raíz del repo)

```sh
bun install       # instalar dependencias
bun run dev       # servidor de desarrollo, http://localhost:8080
bun run build     # build de producción (preset Vercel vía Nitro)
bun run preview   # sirve el build de producción en local
bun run lint      # ESLint
bun run typecheck # tsc del código de app
bun run typecheck:test # tsc con los *.test.ts (tsconfig.test.json, ver docs/agents/testing.md)
bun run test      # suite de lógica pura con el runner de Bun
bun run format    # Prettier --write
```

`bun run test` cubre la lógica pura donde un bug pasa desapercibido — plan, compra, fechas,
parsers de la salida de la IA — con el runner de Bun (sin dependencias nuevas). Ver
[docs/agents/testing.md](docs/agents/testing.md). No hay tests de componentes ni E2E todavía;
Vitest es el siguiente escalón cuando hagan falta.

Necesitas un `.env` con tus propias claves (Supabase + `OPENROUTER_API_KEY` para el coach; VAPID y
`CRON_SECRET` para las notificaciones push). La lista completa, con qué hace cada variable, es
[.env.example](.env.example): cópialo a `.env`.

## Comandos (móvil, `mobile/`)

```sh
cd mobile
npx expo start     # Metro, requiere Xcode para el simulador
npx expo run:ios   # compila y lanza en el simulador
```

Detalles importantes (versiones fijadas, `ios/` autogenerado, locale UTF-8 para `pod install`,
caché de Metro) están en [mobile/AGENTS.md](mobile/AGENTS.md) — no los repitas de memoria, léelos
antes de tocar algo ahí.

## Arquitectura de la web

**Stack:** TanStack Start (React con SSR) + TypeScript + Tailwind v4 + Supabase + OpenRouter
(`google/gemini-2.5-flash` vía `@openrouter/ai-sdk-provider`, ver
[src/lib/ai-provider.server.ts](src/lib/ai-provider.server.ts)). Se despliega en Vercel (preset
`vercel` de Nitro, configurado en [vite.config.ts](vite.config.ts)).

**Rutas:** enrutado por archivos en `src/routes/`, según las convenciones de TanStack Start (no
las de Next.js/Remix) — están explicadas en [src/routes/README.md](src/routes/README.md).
`src/routeTree.gen.ts` es autogenerado; no se edita a mano.

**Server-only:** los módulos que solo deben ejecutarse en el servidor se nombran `*.server.ts`
(TanStack Start no usa el paquete `server-only` de Next.js; un lint en
[eslint.config.js](eslint.config.js) prohíbe importarlo y explica la alternativa). La protección
de imports de [vite.config.ts](vite.config.ts) rompe el build (y `bun run dev`) si un `.server`
llega al grafo del cliente. Por eso un `*.functions.ts` solo exporta `createServerFn` (y tipos):
el compilador borra el cuerpo de cada `.handler()` en el cliente, pero un export cualquiera
—un helper, o un `xxxHandler` exportado para probarlo— conserva el suyo y arrastra sus imports
de servidor. Ese código va en un `*.server.ts` que el `.functions.ts` importa y solo usa dentro
de `.handler()` (ticket 26 de la auditoría).

**API HTTP espejo (`/api/v1/*`):** cada server function de la web tiene también una ruta HTTP en
[src/routes/api/v1/](src/routes/api/v1), porque la app móvil no puede llamar server functions de
TanStack Start (dependen del bundle web) y necesita HTTP normal. La ruta no duplica lógica: invoca
la misma server function vía `apiPost` ([src/lib/api-route.server.ts](src/lib/api-route.server.ts)),
así que la sesión, la validación y las políticas RLS son idénticas por los dos caminos. Al añadir
una operación nueva, exponerla en la API son tres líneas — la lógica de negocio vive en un único
sitio. `apiPost` traduce el error a código (`400` `ValidationError` o JSON malo, `401` sin
sesión, `429` cuota con `retry-after`, `500` el resto) y el campo `error` del JSON se puede
enseñar siempre: un `UserFacingError` llega con su texto y un `Error` cualquiera con uno
genérico. La web recibe lo mismo por el RPC: un middleware global de `start.ts` (`publicError`)
tapa lo demás (ticket 15). Por eso un mensaje para la persona se lanza como `ValidationError` o
`UserFacingError`, nunca como `Error` (tabla completa en AGENTS.md). El `today` que manda el
cliente se lee siempre con `clampClientToday` (decide qué días son pasado).

**Supabase:** [src/integrations/supabase/client.ts](src/integrations/supabase/client.ts) es el
cliente de navegador; `client.server.ts` el de servidor. `auth-middleware.ts` valida la sesión (web
y, vía cabecera `Authorization`, también las peticiones de `/api/v1/*`). Las migraciones SQL viven
en `supabase/migrations/` y se aplican con la CLI (`supabase db push`, siempre tras `--dry-run`),
no pegándolas en el panel; las que aún no tocan, en `supabase/pending/`. Flujo en
`docs/agents/verification.md`.

**Plan de comidas — dos caminos deliberadamente separados** (detalle en «Platos del plan: cambio
a mano vs. recolocación» de AGENTS.md). `setPlanMeal` cambia un plato tal cual lo pide la persona,
sin IA, y lo deja **fijado** (`PlanDay.pinned`): ninguna recolocación automática lo pisa.
`adjustMonthlyPlan`/`reflowMeals` recolocan días futuros con una **lista de cambios** de la IA,
nunca el plan entero, y nunca tocan hoy ni el pasado. **La rejilla no va en orden de calendario:**
qué fecha ocupa cada celda lo dice `dateOfPlanCell`, nunca la posición en la fila. El plan tiene 5
filas (`PLAN_ROWS`; la 5.ª, días 29-31) pero la compra sigue en 4: a `projectTrips` se le pasa
`WEEK_COUNT`, nunca `plan.weeks.length`. Recolocar platos **nunca** cambia la lista de la compra
(lo que falte va como aviso en `PlanDay.extras`); la única excepción es "Rehacer plan con la
familia".

**Macros y kcal — receta canónica, no del modelo** (`src/lib/nutrition/`; detalle en «Receta
canónica, caché y ración personal» de AGENTS.md). El modelo solo propone la COMPOSICIÓN de un
plato (una ración base de AESAN en gramos crudos, `decomposeDishes`); las cifras las pone el
código: tabla `foods.data.ts`, grasa por método de cocción (`OIL_BY_METHOD`) y `validateRecipe`,
calibrado para que ninguna receta del golden set se toque. La receta se guarda una vez para toda
la app (`dish_recipes`, clave `dishKey`) y las macros se calculan **al leer**, nunca se guardan.
Cada plato parte de la ración personal (`portion.ts`) y se escala al objetivo de su comida
(`scale.ts`); el plan y "comí distinto" se escalan igual, o cualquier cambio parecería comer menos.
`closeDay` cierra el día sobre los platos **planeados**, nunca sobre lo comido (si no, se
compensaría dos veces). `foods.data.ts` no entra en el bundle del navegador (lo vigila un lint).
Un cambio que toque cifras se mide con `bun run eval:recipes` y `eval:plan-lite`.

**Todo plato se calcula: nada de promedios** (D13; detalle en la misma sección de AGENTS.md). Un
`MealMacroEstimate` está `calculado` (de su receta, o `manual` si la cifra la apuntó la persona)
o `calculando`: cifras a 0 que no suman ni miden ningún desvío, se enseñan como "Calculando…" y
dejan gris el semáforo. Nunca se rellena con una media: `decomposeDishes` reintenta en cadena
(`decompose-chain.ts`) y Hoy vuelve a pedir lo que falta. Un texto vago se pregunta
(`VAGUE_DISH_MESSAGE`) o se apunta a mano. La proteína también decide si se compensa.

**El plan se comprueba contra el objetivo — UNA ronda** (ticket 10, `plan-fit.ts` puro +
`plan-fit.server.ts`). El escalado tiene límites (una merluza con brócoli no llega a 465 kcal), así
que `planFit` sirve cada día como Hoy (`serveDay`) y marca lo que no cierra (±5 %, proteína < 90 %):
por kcal la principal que menos se deja estirar; por proteína cualquier comida < 75 % de la suya,
también desayuno y merienda, que se corrigen como IDEA SEMANAL y solo en semanas enteramente
futuras. Una petición al modelo, y cada cambio entra solo si baja `dayScore` de sus días. No va al
generar (el plan tarda ~100 s y las recetas del mes no caben en 300 s): la lanza la pantalla Plan
cuando el precalentado deja todo calculado (`fitPlanOnce` → `fitMonthlyPlan`). La marca
`MonthlyPlan.fit` garantiza una ronda por plan (solo con `targetsVersion`), el guardado relee y
aplica con `applyPlanFitChanges` (solo si la celda no cambió) y `PlanFitNote` enseña lo cambiado.
Comidas propias primero (D4). La compra no cambia.

**Objetivo energético — una sola cifra** (ticket 07, `src/lib/nutrition/energy.ts`, puro, copia
en `mobile/lib/energy.ts`). `energyTargets(perfil)` calcula en código kcal, proteína, grasa,
fibra, hidratos y el reparto por comida (Mifflin-St Jeor × PAL del día a día + rutina neta de
`exercise-energy.ts`; ajuste por objetivo con topes; embarazo/lactancia nunca déficit; `null` si
es menor o faltan datos). Es la única cifra de objetivo: la barra de Hoy mide contra ella, el
texto de calorías de la guía lo escribe el código (`caloriesText`), el coach la recibe en el
prompt y la guía guarda una copia (`guide.targets`) para que el semáforo de un día pasado se mida
contra el objetivo que tenía ese día. Entradas: `profiles.daily_activity` (sin deporte) y
`profiles.training` (rutina en forma corta, `parseTraining`); mientras un perfil no tenga
`daily_activity`, se usa `activity_level` normalizado (`normalizeActivity`, que ya incluía el
deporte) y no se suma rutina.

**Ver cifras es una preferencia** (ticket 01, D3): `profiles.nutrition_numbers` (`mostrar` |
`ocultar`) se lee SOLO con `showsNutritionNumbers`. Con `ocultar` no hay kcal, macros ni
objetivos en Hoy, el detalle de día, las tarjetas de picoteo/deporte/balance, `goalImpact` ni el
coach; los platos se calculan igual. Las columnas nuevas de `profiles` (`nutrition_numbers`,
`daily_activity`, `training`) llegan con migración manual: hasta aplicarla, `saveProfile` las
omite (PGRST204) y la UI no las enseña (`hasProfileColumn`, `ProfileField.pendingColumn`).

**Pestaña Hoy — el registro del día se reconcilia al leerlo.** La tira de comidas se pinta desde
`daily_logs.habits`, que se escribe UNA vez al crear el día y lo crea quien toque el día primero
(abrir el chat lo crea vacío). `reconcileHabits` ([src/lib/plan/habits.ts](src/lib/plan/habits.ts))
lo casa en cada carga con `mealsForDate(plan, hoy, effectiveMealSlots(perfil))`: descarta la comida
que ya no se planifica (una merienda descartada en el onboarding dejaba de irse), añade la que
falte y congela `plannedIdea` — el plato que el plan proponía, que es lo que Hoy tacha bajo el
plato real por muchas veces que se cambie (`suggestedDish`). Solo reescribe el día de hoy; un día
pasado es un hecho, no una preferencia.

**El desvío del día se suma antes de decidir — UN solo asentamiento** (feature
`balance-del-dia`; detalle en «Balance del día» de AGENTS.md). Cambiar un plato, picotear y hacer
deporte desvían el día y se resuelven **juntos**: un debounce compartido (`day-settle.ts`) acaba en
**una** llamada a `settleDay`, que suma el día (`dayBalance`), decide **una vez**
(`compensationNeed`) y recoloca **una vez** comidas/cenas propias de mañana a hoy + 6. La compra,
hoy y el pasado no cambian. **El átomo es el día, no el evento:** no conviertas esto otra vez en
una decisión por origen. Tampoco el chat: el registro guiado y la herramienta `registrar_deporte`
guardan igual que Hoy y programan `scheduleDaySettle`; nunca van por `ajustar_plan_mensual`. Los
tres libros (`swapKcalDelta`, `snacks`/`exercise.compensatedKcal`) son la procedencia; el
resultado se guarda una vez en `daily_logs.adjustment`.

**Escrituras concurrentes — siempre sobre la versión más reciente** (ticket 21 de la auditoría).
La fila `monthly_plans` del mes y la fila `daily_logs` del día las escriben varios caminos a la vez (la IA
tarda 10-100 s, dos miembros del hogar, dos toques seguidos). Ninguna escritura es ciega: se lee la
fila con su `updated_at`, se **reconstruye** el cambio sobre lo leído con una función pura
(`applyPlanChanges`, `mergeRegeneratedPlan`, `withPlanMeal`, `withChildMeal`, `withOwnedMark`…) y
se escribe con `.eq("updated_at", leído)`; si no cambia ninguna fila, se relee y se reintenta
(el plan, hasta 5 con una pausa aleatoria de 20-80 ms; el día, hasta 3). Helpers: `updatePlanRowCas` (`plan-rows.server.ts`), `updateShoppingState` (estado de
compra, con la lista blanca de columnas), `updateDailyLogCas` (`daily-rows.server.ts`, el mismo
contrato para cualquier columna de la fila del día; con `create: true` crea la fila, como picoteo y
deporte; `patchDailyHabits` es su atajo para `habits`) y `patchTodayHabits` en el cliente. El trabajo caro no se repite: solo se vuelve a aplicar su
resultado. En la pantalla, el estado de la compra va con `useShoppingMutation` (optimista con esas
mismas funciones y en serie por mes, copia en `mobile/lib/`). `generateMonthlyPlan` usa `insert`:
la restricción única es la guarda contra dos generaciones a la vez.

**Tarjeta "Balance de hoy"** ([day-balance-card.tsx](src/components/day-balance-card.tsx)):
petición explícita del usuario — la persona tiene que VER que lo que hace mueve el plan, con el
desglose por origen y los platos movidos; y cuando no se mueve nada, también lo dice
(`balanceNote`). No vuelvas a poner información de ajuste por comida: el badge "i" mentía.

**Picoteo en Hoy** (feature `picoteo-hoy`, sección larga en AGENTS.md). "Añadir picoteo" (encima de
"Registrar deporte") calcula las kcal con la tabla de composición (`estimateSnack`) y las enseña
antes de guardar; sin cifra fiable se piden a mano. Se guarda en `daily_logs.snacks` (no en
`habits`, que `reconcileHabits` reconstruye) y suma en la barra de macros y en el detalle del día.
Compensar ya no es cosa suya: lo hace `settleDay` con el día entero.

**Cantidades de la compra — modelo canónico por semana.** `generateMonthlyPlan` guarda `shopping`
en **forma canónica**: una fila por ingrediente con `unit` (`g`/`ml`/`ud`) + `weekQty` (cuánto
piden los platos de cada una de las 4 semanas del plan) + `weekPrice`. La IA ya no inventa un `qty`
de texto ni asigna compras. `projectTrips` ([src/lib/shopping/trips.ts](src/lib/shopping/trips.ts))
deriva la vista por compra: cada compra suma la parte de `weekQty`/`weekPrice` de los días que
cubre (`tripDayRange` × `weekDayCounts`), así **Σ entre compras = lo que necesita el mes** y
cambiar de cadencia solo re-trocea el mismo total. `recadenceMonthlyPlan` ya no llama a la IA: solo
guarda la nueva cadencia y la UI re-proyecta. Las listas antiguas (sin `weekQty`) siguen válidas y
caen en el reparto de siempre (`groupByTrip`/`repartitionTrips`); se corrigen al regenerar. Las
marcas "comprado" canónicas viven en `ShoppingItem.ownedTrips[trip]`.

**Cadencia optimizada** (`"optimizada"`, detalle en AGENTS.md). Mismas salidas que la semanal, pero
`stockUpAmounts` adelanta cada ingrediente a la compra que lo aguanta (`shelfLifeDays`, en
`shopping/shelf-life.ts`): lo que no caduca entra entero en la primera, lo fresco cada semana y lo
de vida media cada dos. Determinista, sin IA, y Σ no cambia. Elegida a mitad de mes rige desde la
compra en curso (`plan.cadenceFrom`, que `projectTrips` recibe como `stockUpFrom`); las anteriores
se quedan como en la semanal. Al entrar o salir de ella `recadenceMonthlyPlan` (`recadencePlan`,
puro) quita las marcas "comprado" (`withoutStoreMarks`), la única vez que recadenciar toca una
lista canónica. Una cadencia se valida con `asCadence`, nunca con literales.

**Perecederos — se sesga el plan y se avisa, no se reestructura.** `shelfLifeDays`
([src/lib/perishability.ts](src/lib/perishability.ts)) da la vida útil por palabra clave/categoría;
`freshRisksForTrip` marca los frescos de una compra cuyo tramo de días supera esa vida útil y la UI
lo muestra como aviso (`freshRiskText`; lo que llega justo al último día no avisa, y en la
optimizada propone congelar o comprar el día). El prompt de cadencia mensual
sesga hacia larga vida. La lista de la compra en sí no cambia y no hay compras extra.

**Despensa extra (`monthly_plans.pantry_extras`).** Ingredientes que la persona ya tiene en casa y
que la compra no incluye: los añade a mano en Ingredientes (`setPantryExtra`) o salen del escaneo de
un tiquet (`scanTripReceipt`, se guardan solo los que encajan con sus objetivos). Es un conjunto
paralelo a `shopping`, nunca se fusiona con la lista; `adjustMonthlyPlan`/`setPlanMeal`/
`coachPlanContext` lo tratan como disponible al recolocar. El importe
real del tiquet va a `trip_actuals`; la tarjeta "Gasto en comida" del historial lo muestra
(`MonthSpendSummary`). Cambiar de cadencia en una lista antigua conserva las marcas
"en casa"/"comprado" por nombre de ingrediente (`carryOwnedByName`), no por `name`+`trip`.

**Recálculo del plan (`reflowMonthlyPlan` + [src/lib/plan-recalc.ts](src/lib/plan-recalc.ts)).**
Nunca por tiempo. Dos modos, con disparos distintos:

- `scope: "meals"` (cambió la despensa extra) → **automático y silencioso** (issue 05). El cliente
  (`schedulePlanRecalc`) agrupa varios cambios seguidos con un debounce de ~6 s → **una** llamada a
  `POST /api/v1/plan/reflow`; persiste un "pendiente" en `localStorage`/`AsyncStorage` y la
  pantalla Plan lo relanza al abrirse (`flushPlanRecalc`) si la app se cerró antes. Recoloca
  platos futuros con `reflowMeals` (núcleo compartido con `adjustMonthlyPlan`). La lista de la
  compra **no** cambia.
- `scope: "full"` (entra/sale alguien, cambia ración/alergia/etapa/horario) → **lo pide quien
  planifica** con "Rehacer plan con la familia" en Familia (`rebuildPlanWithHousehold`); el cambio
  en la mesa ya no lo dispara solo (decisión del usuario, 2026-09-28: es la llamada de IA más cara
  y con disparo automático + botón se pagaba dos veces), solo deja un aviso en la pantalla.
  Regenera plan **y** cantidades con el hogar nuevo (`generatePlanBody`) y hace merge:
  `mergeFuturePlan` + `mergeFutureKids` conservan hoy/pasado y un plato puesto a mano;
  `carryOwnedCanonical` traspasa las marcas de compra por nombre; `confirmed_at` se limpia. Al
  acabar copia las comidas compartidas a quien tiene la app (`syncSharedMeals`, devuelve
  `synced`); quien no la tiene solo cuenta como raciones. Ya no hay botón "Sincronizar": esa
  copia también se hace sola al guardar un horario. No mira la despensa extra, así que no
  sustituye a un `"meals"` pendiente.
  Solo lo ejecuta quien planifica en casa (o quien va en solitario): el servidor devuelve
  `skipped: "not-planner"` para un no planificador. Bucket de cuota propio (`plan-reflow`, 12/h).

**Pantalla Plan — navegación de meses y unificación de Historial.** La pantalla tiene dos
subpestañas (Plan e Ingredientes; ya no hay "Historial") y un selector `‹ mes ›` en la cabecera que
gobierna toda la pantalla. El calendario del mes es el navegador del historial: los días pasados
llevan el semáforo del día (`daySignal`: kcal contra el objetivo; rojo solo al pasarse de largo) y
abren un detalle reducido del día (`day-detail-sheet.tsx`). El navegador no baja del mes de
`profiles.app_started_on` ni sube más allá del mes que viene, y este último solo se puede
generar/accionar en su última semana (`isNextMonthUnlocked`, umbral `NEXT_MONTH_UNLOCK_DAYS = 7`, el
mismo del aviso push de renovación). `generateMonthlyPlan` rechaza en servidor los meses pasados y
el mes que viene aún bloqueado. Meses pasados: solo lectura. Helpers de mes en `plan/month.ts`
(`planMonthStatus`, `isMonthActionable`, `planNavBounds`, `addMonths`, `monthTitle`).

**Un plan por mes, tras una conversación con el coach — no se rehace a mano.**
`generateMonthlyPlan` rechaza (400, antes de gastar cuota) un mes que ya tiene fila en
`monthly_plans`, y no hay botón de regenerar. Nada genera un plan por su cuenta: ni Hoy (que sin
plan enseña "Prepara tu plan del mes" y lleva a Plan) ni el onboarding (que acaba en Plan). El
único camino es "Crear plan" → `MonthIntakeChat` (web y móvil): cinco preguntas con chips y texto
libre (`month-intake.ts`, copia en `mobile/lib/`: ausencia con fechas, eventos o comidas fuera,
horario o rutina, ingredientes a usar o evitar, notas). `setMonthConstraints` arma las respuestas
en servidor (`monthIntakeNotes`: etiqueta por pregunta, solo chips de su lista, cada respuesta
limpia con `cleanIntakeText`) y `awayPlanLine` las mete en el prompt entre «» como DATO. Al
generar el primer plan de la persona (`firstPlan`, que devuelve el servidor; no `app_started_on`,
que un demo trae en el pasado) llega la bienvenida del coach (`welcomeBriefing`). Cuándo toca: la
última semana del mes (`isNextMonthUnlocked`) la barra de abajo marca Plan con un punto
(`usePlanNeedsAction`, también con el mes en curso sin plan) y llega un push diario "Es hora de
preparar tu plan de …" hasta que se genere. Después, el plan solo cambia por el coach, por los
desajustes de Hoy (`settleDay`) o por `reflowMonthlyPlan` (hogar, despensa). Motivo: cada
generación + precalentado + ronda de ajuste ronda los 0,7 USD contra un tope diario de 0,75, y
regenerar dejaba sin ajuste el plan nuevo.

**Familia — hogar compartido (`/hogar`).** Feature `familia-comidas-compartidas` (decisiones D1–D5
en `.scratch/familia-comidas-compartidas/`; detalle en «Familia — hogar compartido» de AGENTS.md).
Invariantes que un cambio suele romper sin querer:

- **Un solo planificador** (`is_planner`); su fila `monthly_plans` es la del hogar para las
  comidas compartidas. Cada adulto con cuenta conserva la suya (D1): lo compartido es un espejo
  de lectura (`composeDayForUser`) y se escribe solo desde el planificador (`syncSharedMeals`,
  `guardSharedSlotWrite`). Lo que otro lee de esa fila pasa antes por `cleanSharedPlan`. `household_members` son huecos de la mesa: quien se une reclama uno.
- **Qué se comparte sale de los horarios** (`home_schedule`), con la regla en un solo sitio:
  `effectiveSharedSlots` (idéntico en `mobile/lib/`). **No leas `households.shared_slots` a pelo**
  para decidirlo. Snacks nunca (D5); un bebé que no come de la mesa no cuenta (`feeding_stage`).
- **El estado de la compra es del hogar** (marcas, gasto, tiquets, despensa: cualquier miembro,
  con CAS); platos, cantidades y cadencia solo el planificador. `PlanDay.kids` es el plato aparte
  de un niño.
- **RLS:** toda lectura de la fila propia de `monthly_plans` filtra por `user_id` (`ownPlanRow` /
  `fetchOwnMonthlyPlan`), o lanza `PGRST116`. El copy no da por hecho "tu plan" a quien no
  planifica. "Este plato se cambió a mano" se decide con `isPinnedByViewer`, no con `isPinned`.

**Notificaciones push** (detalle en «Push notifications» de AGENTS.md)**:** Web Push real (VAPID)
vía `@pushforge/builder`, elegido porque solo usa
Web Crypto API (el paquete `web-push` de npm no funciona en el runtime de despliegue). El disparo
periódico vive en la base de datos — `pg_cron` + `pg_net` llaman cada 5 min a
`POST /api/cron/dispatch` (el secreto está en Supabase Vault; el workflow de GitHub Actions queda
solo como disparo manual, porque sus `schedule` se descartaban), que reutiliza
[src/lib/push-dispatch.server.ts](src/lib/push-dispatch.server.ts). Cada aviso se reclama antes de
enviarlo (marca atómica) y pertenece al día de `pushDayFor`. El tono de perfil
(`profiles.tone`) afecta al copy y a la frecuencia en tres sitios distintos (push, repaso nocturno,
prompt del coach) a partir de un único campo.

**Rate limiting (`rate_limits` + `consume_rate_limit`):** cuota por persona y operación para lo
que cuesta dinero (cada llamada a la IA: coach, plan, guía, receta, tiquet) y para recuperar la
contraseña. Vive en la base de datos, no en memoria del proceso, porque en serverless cada
instancia tiene la suya y un contador local no frena un abuso repartido. Los límites se ajustan
en `RATE_LIMITS` ([src/lib/rate-limit.server.ts](src/lib/rate-limit.server.ts)) sin tocar SQL;
el `subject` lo construye siempre el servidor (`user:<uuid>` del JWT ya verificado, o
`email:<sha256>` sin sesión), nunca el cliente. Dos avisos: la función SQL solo la puede ejecutar
`service_role` — si se pudiera llamar con la sesión de una persona, esa persona podría gastarle
la cuota a otra —, y si la consulta falla se **deja pasar** a propósito (un fallo de base de
datos no debe dejar la app sin coach), así que un evento `rate_limit_failopen` en los logs
significa que ahora mismo no hay cuota. Desde un `*.functions.ts` se carga con
`await import(...)`: importa `client.server`, que no puede acabar en el bundle del navegador.

**Logs del servidor — `logEvent`, no `console.error` suelto** ([src/lib/log.server.ts](src/lib/log.server.ts)).
Una línea JSON por evento con nombre fijo en inglés (`snake_case`), para poder buscarlo y ponerle
alertas; el catálogo de eventos está al principio del archivo y se amplía ahí. Los campos pasan por
`redactFields` (`log-redact.ts`, puro y testeado), que tapa correos, nombres, notas, platos, datos
de salud y suscripciones a cualquier profundidad: por eso una clave como `name` o `body` sale
`"[redacted]"` (usa otra), y un error de Supabase se pasa como `errorText(error)`. En el cliente, un
`.catch` nunca va vacío: como poco `console.warn("<pantalla>: <qué hacía>", error)`.
`GET /api/health` (sin BD ni IA) responde `{ ok, version }` y, con `x-cron-secret`, qué variables
de entorno están definidas, el dominio de `RESEND_FROM` y una huella (8 hex del SHA-256) de la
clave de Resend, para saber sin los logs de Vercel por qué no sale un correo.

**Cabeceras de seguridad** (`securityHeadersMiddleware` en `start.ts`). La CSP va en modo
Report-Only (`buildCsp`, [src/lib/csp.ts](src/lib/csp.ts)): no bloquea, avisa a
`/api/csp-report` y deja `csp_violation` en el log. Un origen externo nuevo que pida el
navegador (un SDK, un CDN, una imagen remota) se añade a `buildCsp`, o el día que la CSP se
aplique (ticket 37) dejará de funcionar. En `bun run dev` sale un `eval` en `script-src`: es de
Vite, el build de producción no lo tiene.

**Tope de gasto en IA (`ai_spend` + `record_ai_spend`):** complementa las cuotas por hora con un
tope en dólares por persona, diario y mensual (`AI_SPEND_CAPS`, junto a `RATE_LIMITS`; días y
meses en UTC). `createAiProvider(key, userId)` exige `userId` y envuelve cada modelo en un
middleware que mira el tope **antes de cada llamada** y suma después el `usage.cost` real de
OpenRouter (pedido con `usage: { include: true }`; si no llega, se estima por tokens). Así no se
escapa ninguna llamada: reintentos y helpers sin bucket (`offShoppingList`) incluidos.
`enforceUserRateLimit` lo mira también en la entrada, para cortar con 429 antes de hacer trabajo.
Mismo `RateLimitError` (su `scope` `day`/`month` cambia el mensaje) y mismo "dejar pasar" si falla
la base de datos, con `spend_cap_failopen` / `spend_record_failed` en el log. Ojo con `streamText`: un error del middleware no llega a `result.text`
(rechaza con un genérico), solo a `onError` — por eso `askForJson` lo captura ahí y no reintenta.
Lógica pura y testeada en [src/lib/ai-spend.ts](src/lib/ai-spend.ts). **Excepción deliberada:**
la descomposición de platos va con `createAiProvider(key, userId, { capScope: "month" })` y
`generateDailyGuide` entra con `enforceUserRateLimit(…, "guide", "month")`: el tope DIARIO no las
corta (el mensual sí), porque dejar un plato sin calcular rompe D13 y cuesta céntimos. Siguen
sumando al gasto y a las cuotas por hora; el texto de la guía sí respeta el tope diario.

**Presupuesto de tiempo por petición** ([src/lib/deadline.ts](src/lib/deadline.ts), ticket 22
de la auditoría). Toda la app es UNA función de Vercel de 300 s, y la cadena de platos, el plan
o `askForJson` (tres intentos) podían pasar de ahí: Vercel la corta y se pierde lo no guardado.
Las server functions largas crean `requestDeadline()` (270 s) al entrar y lo pasan hacia abajo;
cada paso con el modelo se acorta con `stepTimeout` y no empieza con menos de 10 s
(`hasTimeFor`). Lo que no cabe sale "Calculando…" (motivo `sin-tiempo`) y lo recoge el
reintento de Hoy. `getRecipes` guarda cada receta en cuanto es definitiva (no al final) y
deduplica por instancia el plato que ya se está descomponiendo. La reserva de `settleDay`
lleva su marca en `daily_logs.adjustment.pending`: si la petición muere, el siguiente
asentamiento la devuelve pasados 5 min (`RESERVATION_TTL_MS`, ligado al `maxDuration`).

**Límites: alcance de la IA y contenido de la persona** (detalle y porqué en la sección del mismo
nombre de AGENTS.md; spec en `.scratch/limites-ia-y-contenido/`). Dos límites, cada uno con dos
redes:

- **El coach solo habla de alimentación.** La regla vive SOLO en `coachSystemPrompt`: una
  superficie de IA nueva la hereda si usa ese prompt. `offTopicReason` corta en `/api/chat` antes
  de gastar cuota. Todo texto libre del perfil entra por `asPromptData` («», declarado como dato).
- **Lo que se escribe como comida es comida.** `assertCleanFood` va en el `.validator()` de cada
  server function que guarda un plato (por `apiPost` cubre web, móvil y coach); `content-guard.ts`
  compara por token entero, nunca por subcadena. Segunda red: `comida`/`isFood` de `resolveDish`
  y `decomposeDishes`, sin llamadas nuevas.

Ante la duda se **deja pasar**. `assertCleanName` avisa pero **no es frontera** (esas escrituras
van del navegador directo a Supabase).

**Dictado por voz — siempre sobre un campo** (sección del mismo nombre en AGENTS.md).
`DictateButton` va dentro de un `DictationField` junto a su campo de texto, nunca suelto: lo
dictado se ve y se corrige antes de enviarlo. `DictationWave` cubre el campo con el volumen real
de la voz (`useDictation().level`, un ref) mientras se pulsa; en iOS, además, vibra
(`expo-haptics`, antes de abrir el micro).

**Exportar el historial** (Ajustes → Datos y cuenta, web y móvil). `buildHistoryCsv`
([src/lib/history-export.ts](src/lib/history-export.ts), copia en `mobile/lib/`) arma en el cliente
un CSV con comidas, picoteo, deporte y peso a partir de `fetchAllLogs` (RLS: solo filas propias).
No calcula nada: las cifras son las de `guide.mealMacros` de cada día, las mismas del detalle de
día; sin cifra, celda vacía. Con `nutrition_numbers = ocultar` no lleva columnas de kcal ni macros.

**Guion del onboarding — identificadores, no texto** (ticket 34;
[src/lib/onboarding-script.ts](src/lib/onboarding-script.ts), puro, copia en `mobile/lib/`).
Preguntas y chips tienen un `id` estable y su texto vive en el catálogo (`onboarding.q.<id>`),
así la pantalla sale en el idioma de la persona. Las respuestas siguen siendo texto libre: lo que
decide algo (`meal_slots`, `nutrition_numbers`, qué pregunta va detrás) se lee con
`chipsOfAnswer`, que reconoce la etiqueta en cualquier idioma, y se guarda en español canónico.
Las claves de respuesta son posicionales (`si-qi`): mover una pregunta obliga a subir
`DRAFT_STORAGE_KEY` (un test fija la lista). `parseOnboarding` devuelve los valores de lista
siempre en español y el texto libre en el idioma de la persona.

## Convenciones de código

- Alias de imports: `@/*` apunta a `src/*` (ver `tsconfig.json` y `components.json`).
- `src/lib/plan-shared.ts` es un barrel: la lógica pura del plan y la compra vive en
  `src/lib/plan/*.ts` y `src/lib/shopping/*.ts`, un módulo por tema. Fuera de esas carpetas se
  importa siempre de `@/lib/plan-shared`; dentro, entre módulos con import relativo y nunca del
  barrel. Un tipo puede ir en círculo (`import type`), un valor no.
- `src/lib/plan.functions.ts` es otro barrel, el de las server functions del plan y la compra:
  un `*.functions.ts` por tema en `src/lib/plan/` y `src/lib/shopping/` (generar, ajustar al
  objetivo, recolocar, platos, coach, estado de la compra), y los helpers que comparten en
  `*.server.ts` de las mismas carpetas (`rows.server.ts`: `ownPlanRow`, `resolveShoppingRow`,
  `updateShoppingState`, `guardSharedSlotWrite`…; `ai.server.ts`: `askForJson`,
  `enforceBudget`; `reflow.server.ts`: `reflowMeals`). El barrel solo reexporta los
  `.functions.ts`; quien necesite un helper lo importa de su `.server.ts`.
- Componentes de UI: shadcn/ui, estilo `new-york`, iconos de `lucide-react`, en
  `src/components/ui/`.
- Formato: Prettier (`printWidth` 100, comillas dobles, `;` siempre) — corre `bun run format`
  antes de dar algo por terminado.
- La paleta de color de la web está en hex en `src/styles.css` y la app móvil tiene una copia en
  `mobile/tailwind.config.js` (React Native no lee las variables CSS de la web). Si cambias un
  color en la web, hay que replicarlo ahí a mano — son dos copias.
- Guidelines de UI (color, tipografía, radios, espaciado, componentes, movimiento, tono de voz):
  [docs/design-guidelines.md](docs/design-guidelines.md). Consúltalo antes de tocar estilos para
  no apartarte de los valores ya establecidos.

## Agent skills

### Issue tracker

Issues y specs viven como markdown en `.scratch/`. Ver `docs/agents/issue-tracker.md`.

### Domain docs

Documentación de dominio en modo single-context (`CONTEXT.md` + `docs/adr/` en la raíz). Ver
`docs/agents/domain.md`.

### Verificación

Cómo se demuestra que un cambio funciona en este repo: puertas estáticas (`lint`, `typecheck`,
`test`), preview del navegador con perfil demo para cualquier cosa que mute datos, y sin base
de datos local. Ver `docs/agents/verification.md` y `docs/agents/testing.md`.

### Code review

Checklist de convenciones e invariantes específicas del proyecto (idioma, frontera
cliente/servidor, espejo `/api/v1`, invariantes de plan y compra, paridad web/móvil), más allá
del `/code-review` genérico. La aplica la skill `/senda-review`. Ver
`docs/agents/code-review.md`.
