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
bun run typecheck # tsc del código de app (los *.test.ts van aparte, ver docs/agents/testing.md)
bun run test      # suite de lógica pura con el runner de Bun
bun run format    # Prettier --write
```

`bun run test` cubre la lógica pura donde un bug pasa desapercibido — plan, compra, fechas,
parsers de la salida de la IA — con el runner de Bun (sin dependencias nuevas). Ver
[docs/agents/testing.md](docs/agents/testing.md). No hay tests de componentes ni E2E todavía;
Vitest es el siguiente escalón cuando hagan falta.

Necesitas un `.env` con tus propias claves (Supabase + `OPENROUTER_API_KEY` para el coach; VAPID y
`CRON_SECRET` para las notificaciones push — ver la lista completa de variables en `.env` o en
AGENTS.md).

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
`src/routes/routeTree.gen.ts` es autogenerado; no se edita a mano.

**Server-only:** los módulos que solo deben ejecutarse en el servidor se nombran `*.server.ts`
(TanStack Start no usa el paquete `server-only` de Next.js; un lint en
[eslint.config.js](eslint.config.js) prohíbe importarlo y explica la alternativa).

**API HTTP espejo (`/api/v1/*`):** cada server function de la web tiene también una ruta HTTP en
[src/routes/api/v1/](src/routes/api/v1), porque la app móvil no puede llamar server functions de
TanStack Start (dependen del bundle web) y necesita HTTP normal. La ruta no duplica lógica: invoca
la misma server function vía `apiPost` ([src/lib/api-route.server.ts](src/lib/api-route.server.ts)),
así que la sesión, la validación y las políticas RLS son idénticas por los dos caminos. Al añadir
una operación nueva, exponerla en la API son tres líneas — la lógica de negocio vive en un único
sitio. Ojo: `apiPost` devuelve `500` tanto para fallos reales como para errores de validación
pensados para enseñarse en pantalla; el cliente debe guiarse por el campo `error` del JSON, no
solo por el código HTTP.

**Supabase:** [src/integrations/supabase/client.ts](src/integrations/supabase/client.ts) es el
cliente de navegador; `client.server.ts` el de servidor. `auth-middleware.ts` valida la sesión (web
y, vía cabecera `Authorization`, también las peticiones de `/api/v1/*`). Las migraciones SQL viven
en `supabase/migrations/`.

**Plan de comidas — dos caminos deliberadamente separados** (ver
[src/lib/plan.functions.ts](src/lib/plan.functions.ts) y
[src/lib/plan-shared.ts](src/lib/plan-shared.ts)):

- `setPlanMeal` cambia un plato de un día concreto tal cual lo pide la persona, sin IA de por
  medio — así es verificable que se aplicó lo pedido.
- `adjustMonthlyPlan` recoloca varios días futuros para compensar (comió de más, hizo ejercicio);
  el día de hoy nunca se toca. La IA **no** devuelve el plan entero, sino una lista de cambios
  (`{"cambios": [{"fecha","comida","cena"}]}`, ver `cleanReflowChanges` + `applyPlanChanges`):
  pidiéndole las cuatro semanas de vuelta copiaba el plan tal cual casi siempre. Las fechas que
  puede tocar van explícitas en el prompt y se validan al aplicarlas. Si el desvío en kcal supera
  `FORCE_ADJUST_KCAL` y no cambia nada, se le insiste una vez.

Un cambio a mano (`setPlanMeal`, que escribe con `withPlanMeal`) queda **fijado** en
`PlanDay.pinned`: ninguna recolocación automática lo pisa (`applyPlanChanges`, `mergeFuturePlan`, y
el prompt de `reflowMeals` lo marca como `"fijo"`). Hace falta porque comida y cena viven en los
mismos campos (`lunch`/`dinner`) que escribe la IA; antes solo sobrevivían desayuno y merienda
(`breakfast`/`snack`, que además mandan sobre la rotación semanal). "Deshacer" manda `pin: false`
con el `previousPinned` que devuelve `setPlanMeal`. En el hogar, la marca de una comida compartida
viaja con el plato del planificador (`mirrorPinned`). **Ojo con la rejilla del plan:** las semanas van por día del mes
(`floor((día-1)/7)`) y la posición dentro de la fila es el día de la semana, así que el orden de la
fila no es el del calendario — un lunes 7 es la última fecha de la semana 0 pero la posición 0.
Qué fecha ocupa cada celda lo dice `dateOfPlanCell`, y es lo que decide qué se puede reescribir;
compararlo por posición hacía que la recolocación pisara días pasados y no tocara ninguno futuro. Al recolocar platos (`adjustMonthlyPlan`, `setPlanMeal`, recálculo por
despensa) la lista de la compra nunca cambia — si un plato pide algo no comprado, se guarda igual y
aparece como aviso en `PlanDay.extras`. La única excepción es un cambio en la mesa del hogar, que
sí re-dimensiona las cantidades (ver "Recálculo automático del plan" más abajo).

**Macros y kcal — receta canónica, no del modelo** (`precision-nutricional`, fase 2;
`src/lib/nutrition/`, explicación larga en AGENTS.md). El modelo solo propone la COMPOSICIÓN de un
plato: `decomposeDishes` (`resolve-dish.server.ts`) pide con salida estructurada UNA ración base de
AESAN en gramos **crudos**, y el código pone la cantidad y las cifras: casado contra la tabla
(`foods.data.ts`, por 100 g con `basis` crudo/cocinado; `matchFood`/`resolveIngredient` en
`nutrition.ts`), grasa por método de cocción (`OIL_BY_METHOD`, `cooking.ts`) y `validateRecipe`
(techos, inventados, UN reintento con pista; calibrado para no tocar el golden set). La receta se
guarda **una vez para toda la app** en `dish_recipes` (`getRecipes`, `recipes.server.ts`, clave
`dishKey`) y las macros se calculan **al leer** (`macrosOfRecipe(receta, factor)`), nunca se
guardan. El punto de partida es la **ración personal** (`portion.ts`): `plan` = objetivo ÷ 2.000
en los platos del plan (la media de los adultos en una comida compartida, que no se guarda con la
comida por privacidad) y `habitual` = mantenimiento ÷ 2.000 en "comí distinto". Encima, **cada
plato se escala al objetivo de su comida** (`scale.ts`, ticket 08 adelantado): verdura y fruta
fijas, dos factores para el grupo proteína y el grupo energía (kcal primero, luego proteína),
con límites para que el plato siga siendo el mismo; `plannedMacros` para el plan (objetivo de
`perSlot` + `PlanDay.kcalAdjust`, o la media del hogar en una compartida, vía
`plannedServingsFor`) y `eatenMacros` para "comí distinto" (el objetivo de esa comida a
mantenimiento, × texto o chip). Los dos lados se escalan igual: si no, cualquier cambio de plato
parecería comer menos. Una ración de AESAN es una unidad (se recomiendan varias al día), así que
sin escalar el día del plan se quedaba en ~60 % del objetivo. La pantalla Plan
precalienta los platos del mes (`recipe-warm.ts`, `/api/v1/recipes/warm`). Ingredientes que no
casan y pesan: USDA (`usda.server.ts`, `USDA_FDC_API_KEY`, tabla `foods_extra`) y si no, el más
parecido. Medida: `bun run eval:recipes` (exactitud contra el golden set) y `bun run
eval:plan-lite` (el plan contra el objetivo); gastan llamadas y no van en CI.
`src/lib/nutrition/index.ts` reexporta solo lo puro; `foods.data.ts` no debe entrar en el bundle
de navegador. Las migraciones `dish_recipes` y `foods_extra` son manuales: sin ellas todo
funciona, sin caché global.

**Todo plato se calcula: nada de promedios** (ticket 13 de `precision-nutricional`, D13; ya no
existe `roughMealMacros`). Cada `MealMacroEstimate` está `calculado` (sale de su receta, o la
cifra la apuntó la persona: `manual`) o `calculando` (cifras a 0 que **no** suman, no miden
ningún desvío y se enseñan como "Calculando…"; el semáforo del día queda gris). Una guía sin
`status` cuenta como calculada. La cadena de `decomposeDishes` no se rinde a la primera: lote →
reintento uno a uno → `DISH_FALLBACK_MODEL` (otra familia) → `calculando` con su motivo en el log
(`decompose-chain.ts`, puro y testeado). Hoy reintenta lo que queda al abrirse, al volver a la app
y cada 2 min (máx. 5 seguidos) con `macrosOnly` + `reuse` (solo se descompone lo que falta); el
detalle de un día pasado recalcula al abrirse. Un ingrediente que no casa cae en la mediana de su
`categoria` (la da el modelo) y, si aporta ≥ 5 % de las kcal, en el alimento más parecido de esa
categoría que elige `DISAMBIGUATION_MODEL` de una lista cerrada (sin cifras); `GENERIC_FOOD` solo
queda sin categoría. Un texto vago ("algo rápido") lo detecta `resolveDish` en `setPlanMeal`
(`VAGUE_DISH_MESSAGE`): la hoja de "comí distinto" pide concretar u ofrece apuntar las kcal a mano
(`MealHabit.manualKcal`). La **proteína** entra en la decisión de compensar: `perMealDeltas`
devuelve kcal y proteína, `MealHabit.swapProteinDelta` lleva la misma contabilidad que
`swapKcalDelta`, y `settleDay` pasa `balance.proteinPending` a `compensationNeed`.

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
(abrir el chat lo crea vacío). `reconcileHabits` ([src/lib/plan-shared.ts](src/lib/plan-shared.ts))
lo casa en cada carga con `mealsForDate(plan, hoy, effectiveMealSlots(perfil))`: descarta la comida
que ya no se planifica (una merienda descartada en el onboarding dejaba de irse), añade la que
falte y congela `plannedIdea` — el plato que el plan proponía, que es lo que Hoy tacha bajo el
plato real por muchas veces que se cambie (`suggestedDish`). Solo reescribe el día de hoy; un día
pasado es un hecho, no una preferencia.

**El desvío del día se suma antes de decidir — UN solo asentamiento** (feature `balance-del-dia`,
spec en `.scratch/balance-del-dia/`). Cambiar un plato en Hoy, picotear y hacer deporte desvían el
día, y los tres se resuelven juntos: `day-settle.ts` tiene **un** debounce de 10 s compartido (el
"pendiente" se persiste y se fuerza al ocultar la app, misma forma que `plan-recalc.ts`) que acaba
en **una** llamada a `settleDay` ([src/lib/day-settle.functions.ts](src/lib/day-settle.functions.ts)).
Esa función suma el día con `dayBalance` ([src/lib/day-balance.ts](src/lib/day-balance.ts), puro y
testeado), decide **una vez** con `compensationNeed` (tabla aprobada por objetivo), reserva los tres
libros de cuentas a la vez y llama **una vez** a `reflowMeals` con la nota del día entero
(`dayNote`). Recoloca comidas/cenas **propias** de mañana a hoy + 6 (`compensationWindow`,
`soloOnly`); la compra, hoy y el pasado no cambian. Como los platos del plan se escalan al objetivo de su comida,
cambiar un plato por otro más ligero ya no aligera nada por sí solo: `reflowMeals` guarda en cada
día recolocado lo que mueve cada plato (`PlanDay.kcalAdjust`, puente hasta el ticket 12, que lo
escribirá sin cambiar platos) y el escalado apunta a `objetivo + ajuste`. Lo que dice la tarjeta
(`absorbedKcal`) es exactamente lo que cambian esos días.

Antes cada origen tenía su libro, su timer, su umbral y su llamada a la IA, los tres sobre la misma
ventana de días. Eso rompía la exactitud por los dos lados: picotear +250 y quemar −300 (un día a
−50, o sea nada) lanzaba dos recolocaciones en direcciones opuestas, y un cambio de plato de +120
con un picoteo de +110 (+230 reales, por encima del umbral) no movía nada porque ninguno llegaba a
200 en su propio libro. **El átomo es el día, no el evento.** No conviertas esto otra vez en una
decisión por origen.

**El chat tampoco compensa por origen.** El deporte y lo que se come encima del plan nunca van
por `ajustar_plan_mensual` (que decidía con una cifra estimada por el modelo y contaba también las
sesiones de la rutina, que ya van en el objetivo — ticket 16, D9):

- El registro guiado del chat (`guided-log-sheet.tsx`, web y móvil) guarda igual que Hoy:
  "Actividad" con `logExercise` y "Picoteo o extra" con `SnackForm` (el formulario de
  `snack-sheet.tsx`, que usa también "Añadir picoteo"). Una comida del plan cambiada por otra NO
  va ahí — como extra contaría también la comida planeada —, sino por "Comí otra cosa" o
  `cambiar_plato`. El chat programa `scheduleDaySettle` (con `ensureDaySettleDeps` por si Hoy no
  se ha montado) y al coach solo le llega un acuse (`day-log-ack.ts`) con una marca en el
  `metadata`, así que `/api/chat` contesta ese turno **sin herramientas**. El prefijo del acuse
  queda en el historial y el prompt prohíbe volver a registrarlo o compensarlo después.
- El deporte contado por escrito va por la herramienta `registrar_deporte` (actividad, minutos e
  intensidad de las listas de `exercise.ts`; las kcal no las da el modelo), que en el cliente
  (`use-coach-actions.ts`, web y móvil) hace lo mismo: `logExercise` + `scheduleDaySettle`.

Los tres libros siguen donde estaban y son la PROCEDENCIA (`habits[].swapKcalDelta`,
`snacks.compensatedKcal`, `exercise.compensatedKcal`): de ahí sale el desglose que se enseña, y
mantienen la garantía de no compensar dos veces. El RESULTADO se guarda una sola vez, en
`daily_logs.adjustment` — el código tolera que la columna no exista todavía (42703), como
`reflowMeals` con `snacks`. `dayReversing` generaliza a todo el día las reglas que picoteo y
deporte tenían por separado para "esto deshace un ajuste ya aplicado".

Lo que aporta `use-meal-swap.ts` a ese lote es solo `resolveDishDeltas`: regenerar las macros del
día una vez y sacar el desvío por comida contra `plannedKcal` (congelada como `plannedIdea`, para
medir siempre contra el plan y no contra el cambio anterior). `setPlanMeal` escribe el plato al
instante y sin IA, y el estado es por comida, no global. Cada escritura de `habits` desde el cliente
pasa por `patchTodayHabits`, que relee la fila justo antes.

**Tarjeta "Balance de hoy"** ([src/components/day-balance-card.tsx](src/components/day-balance-card.tsx)),
debajo de "Registrar deporte". Es una petición explícita del usuario: la persona tiene que VER que
lo que hace mueve el plan de los próximos días, porque eso genera confianza. Enseña el desvío del
día con el **desglose por origen** (comidas cambiadas · picoteo · deporte), que es lo que hace
legible la causalidad, y debajo los platos que se han movido, con el anterior tachado. El número es
inmediato (deterministas: tabla de composición y `estimateExerciseKcal`); los platos tardan lo que
tarde el modelo, y entre medias dice "Ajustando tus próximos días…". Cuando el plan **no** se mueve
también lo dice (`balanceNote`) — un "no he cambiado nada" explicado demuestra que el sistema estaba
mirando. Sustituye al bloque de ajuste de `snack-card` y `exercise-card` (ahora solo listas), a las
tres instancias de `AdjustmentInfoSheet` y al badge "i" por comida, que mentía: el servidor escribía
la misma lista de cambios en todas las comidas del lote.

**Picoteo en Hoy** (feature `picoteo-hoy`, sección larga en AGENTS.md). "Añadir picoteo" (encima de
"Registrar deporte") calcula las kcal con la tabla de composición (`estimateSnack`) y las enseña
antes de guardar; sin cifra fiable se piden a mano. Se guarda en `daily_logs.snacks` (no en
`habits`, que `reconcileHabits` reconstruye) y suma en la barra de macros y en el detalle del día.
Compensar ya no es cosa suya: lo hace `settleDay` con el día entero.

**Cantidades de la compra — modelo canónico por semana.** `generateMonthlyPlan` guarda `shopping`
en **forma canónica**: una fila por ingrediente con `unit` (`g`/`ml`/`ud`) + `weekQty` (cuánto
piden los platos de cada una de las 4 semanas del plan) + `weekPrice`. La IA ya no inventa un `qty`
de texto ni asigna compras. `projectTrips` ([src/lib/plan-shared.ts](src/lib/plan-shared.ts))
deriva la vista por compra: cada compra suma la parte de `weekQty`/`weekPrice` de los días que
cubre (`tripDayRange` × `weekDayCounts`), así **Σ entre compras = lo que necesita el mes** y
cambiar de cadencia solo re-trocea el mismo total. `recadenceMonthlyPlan` ya no llama a la IA: solo
guarda la nueva cadencia y la UI re-proyecta. Las listas antiguas (sin `weekQty`) siguen válidas y
caen en el reparto de siempre (`groupByTrip`/`repartitionTrips`); se corrigen al regenerar. Las
marcas "comprado" canónicas viven en `ShoppingItem.ownedTrips[trip]`.

**Perecederos — se sesga el plan y se avisa, no se reestructura.** `shelfLifeDays`
([src/lib/perishability.ts](src/lib/perishability.ts)) da la vida útil por palabra clave/categoría;
`freshRisksForTrip` marca los frescos de una compra cuyo tramo de días supera esa vida útil y la UI
lo muestra como aviso ("cómpralos más cerca de cuando los cocines"). El prompt de cadencia mensual
sesga hacia larga vida. La lista de la compra en sí no cambia y no hay compras extra.

**Despensa extra (`monthly_plans.pantry_extras`).** Ingredientes que la persona ya tiene en casa y
que la compra no incluye: los añade a mano en Ingredientes (`setPantryExtra`) o salen del escaneo de
un tiquet (`scanTripReceipt`, se guardan solo los que encajan con sus objetivos). Es un conjunto
paralelo a `shopping`, nunca se fusiona con la lista; `adjustMonthlyPlan`/`setPlanMeal`/
`coachPlanContext` lo tratan como disponible al recolocar. El importe
real del tiquet va a `trip_actuals`; la tarjeta "Gasto en comida" del historial lo muestra
(`MonthSpendSummary`). Cambiar de cadencia en una lista antigua conserva las marcas
"en casa"/"comprado" por nombre de ingrediente (`carryOwnedByName`), no por `name`+`trip`.

**Recálculo automático del plan (`reflowMonthlyPlan` + [src/lib/plan-recalc.ts](src/lib/plan-recalc.ts)).**
Un cambio en la despensa extra o en la mesa del hogar dispara un recálculo **silencioso** del plan
(issue 05: el usuario revirtió el "sin disparar regeneración" de antes). El disparo es por evento,
nunca por tiempo. El cliente (`schedulePlanRecalc`) agrupa varios cambios seguidos con un debounce
de ~6 s → **una** llamada a `POST /api/v1/plan/reflow`; persiste un "pendiente" en
`localStorage`/`AsyncStorage` y la pantalla Plan lo relanza al abrirse (`flushPlanRecalc`) si la
app se cerró antes. `reflowMonthlyPlan` tiene dos modos:

- `scope: "meals"` (cambió la despensa) → recoloca platos futuros con `reflowMeals` (núcleo
  compartido con `adjustMonthlyPlan`). La lista de la compra **no** cambia.
- `scope: "full"` (entra/sale alguien, cambia ración/alergia/etapa) → regenera plan **y** cantidades
  con el hogar nuevo (`generatePlanBody`) y hace merge: `mergeFuturePlan` + `mergeFutureKids`
  conservan hoy/pasado y un plato puesto a mano; `carryOwnedCanonical` traspasa las marcas de compra
  por nombre; `confirmed_at` se limpia.
  Solo lo ejecuta quien planifica en casa (o quien va en solitario): el servidor devuelve
  `skipped: "not-planner"` para un no planificador. Bucket de cuota propio (`plan-reflow`, 12/h).

**Pantalla Plan — navegación de meses y unificación de Historial.** La pantalla tiene dos
subpestañas (Plan e Ingredientes; ya no hay "Historial") y un selector `‹ mes ›` en la cabecera
que gobierna toda la pantalla. El calendario del mes es el navegador del historial: los días
pasados llevan el semáforo de cumplimiento (`ratioSignal`, sin rojo) y abren un detalle reducido
del día (`day-detail-sheet.tsx`). El navegador no baja del mes de `profiles.app_started_on` ni
sube más allá del mes que viene, y este último solo se puede generar/accionar en su última semana
(`isNextMonthUnlocked`, umbral `NEXT_MONTH_UNLOCK_DAYS = 7`, el mismo del aviso push de
renovación). `generateMonthlyPlan` rechaza en servidor los meses pasados y el mes que viene aún
bloqueado. Meses pasados: solo lectura. Helpers de mes en `plan-shared.ts` (`planMonthStatus`,
`isMonthActionable`, `planNavBounds`, `addMonths`, `monthTitle`).

**Familia — hogar compartido (`/hogar`).** Modelo de la feature `familia-comidas-compartidas`
(spec y decisiones D1–D5 en `.scratch/familia-comidas-compartidas/`; explicación larga en la
sección "Familia — hogar compartido" de AGENTS.md). Invariantes que un cambio suele romper sin
querer:

- **Un solo planificador** (`household_members.is_planner`, trigger). Su fila `monthly_plans`
  es la del hogar para las comidas compartidas. Traspaso automático al miembro con cuenta de
  más edad si sale o borra su cuenta (trigger `AFTER DELETE`, D3).
- **`household_members` son huecos de la mesa**: `user_id` NULL-able (hueco sin reclamar o
  adulto sin app), `display_name` obligatorio, `portion` para la compra. Quien se une elige su
  hueco (`household_open_slots` / `claim_household_slot`), no inserta una fila.
- **`households.shared_slots`** (`{desayuno,comida,cena: number[]}`) es la única config de
  comidas compartidas, a nivel de hogar. Adiós a `household_members.shared_meals` y a la
  intersección. Solo la edita el planificador (D2); snacks nunca (D5).
- **Cada adulto con cuenta conserva su fila `monthly_plans` (D1)**: los slots compartidos son
  un espejo de lectura del planificador (`composeDayForUser` /
  `composeMonthlyPlanForMember` al leer; `syncSharedMeals` al escribir hacia adelante,
  siempre desde la fila del planificador), los no compartidos los edita él.
  `generateMonthlyPlan` tiene modo "solo mis slots" para no planificadores. Un no
  planificador que pida tocar una comida compartida recibe un aviso (`guardSharedSlotWrite`).
- **El estado de la compra es del hogar**: marcas "en casa"/"comprado", gasto, tiquets y
  despensa los edita cualquier miembro con cuenta sobre la lista del planificador
  (`resolveShoppingRow` → `readShoppingRow` / `writeShoppingState`; `supabaseAdmin` + solo
  columnas de estado para un no planificador). Los platos, las cantidades y la cadencia, no.
- **`PlanDay.kids`** (`{childId, slot, dish, off?}`): plato aparte de un niño cuando el
  compartido no le vale. Lo emite la IA o lo cambia el planificador con `setChildMeal` (ruta
  `/api/v1/plan/child-meal`, solo pasado bloqueado — hoy en adelante, igual que `setPlanMeal` —,
  la compra no cambia). Se espeja con la
  comida compartida.
- **`household_children.feeding_stage`** (`pecho` · `triturados` · `mesa`, default `mesa`):
  los bebés que aún no comen de la mesa van aparte. `eatsTableFood`/`childRation`
  (`household-shared.ts`) sacan a los no-`mesa` de las raciones del plato compartido
  (`servingsPerSlot`, `deriveSharedSlots`) y de la compra de la casa; `pecho` no lleva plato,
  `triturados` lleva SIEMPRE el suyo en `PlanDay.kids` (puré, ración pequeña). La ficha del
  peque (`child-sheet.tsx`) tiene el selector "¿Qué come?" y Familia agrupa a los bebés en
  "Bebés · aún no comen de la mesa".
- **El coach conoce el hogar**: `householdContext` alimenta `generateMonthlyPlan`,
  `adjustMonthlyPlan`, `welcomeBriefing` y `/api/chat` (vía `supabaseFromRequest`). Revisa que
  el copy no dé por hecho "tu plan" para un no planificador (incluido el push de renovación).
- **RLS**: toda lectura de `monthly_plans` que espere una sola fila propia filtra por
  `.eq("user_id", …)` (`ownPlanRow` / `fetchOwnMonthlyPlan`) — hay una policy de SELECT que si
  no deja ver 2 filas y lanza `PGRST116`.
- **`PlanDay.pinned` en un slot compartido no distingue quién lo cambió**: `mirrorPinned`
  copia el pin del planificador a todos los miembros por igual, así que un `isPinned(...)` a
  pelo en la UI (p. ej. para ocultar "Ver receta" tras un cambio a mano) apagaba la receta a
  todo el hogar aunque solo el planificador hubiera tocado el plato. Como `guardSharedSlotWrite`
  impide que un no planificador escriba un slot compartido, "lo cambié yo" para ese slot
  equivale a "soy el planificador" — de ahí `dishChangeIsMine`/`isPinnedByViewer`
  (`plan-shared.ts`), que sí lo distinguen y son los que debe usar cualquier UI nueva que decida
  algo por "este plato se cambió a mano".

**Notificaciones push:** Web Push real (VAPID) vía `@pushforge/builder`, elegido porque solo usa
Web Crypto API (el paquete `web-push` de npm no funciona en el runtime de despliegue). El disparo
periódico no usa un cron nativo de la plataforma — un workflow de GitHub Actions
([.github/workflows/push-dispatch.yml](.github/workflows/push-dispatch.yml)) llama cada 15 min a
`POST /api/cron/dispatch`, que reutiliza
[src/lib/push-dispatch.server.ts](src/lib/push-dispatch.server.ts). El tono de perfil
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
datos no debe dejar la app sin coach), así que un error de `consume_rate_limit` en los logs
significa que ahora mismo no hay tope de gasto. Desde un `*.functions.ts` se carga con
`await import(...)`: importa `client.server`, que no puede acabar en el bundle del navegador.

**Tope de gasto en IA (`ai_spend` + `record_ai_spend`):** complementa las cuotas por hora con un
tope en dólares por persona, diario y mensual (`AI_SPEND_CAPS`, junto a `RATE_LIMITS`; días y
meses en UTC). `createAiProvider(key, userId)` exige `userId` y envuelve cada modelo en un
middleware que mira el tope **antes de cada llamada** y suma después el `usage.cost` real de
OpenRouter (pedido con `usage: { include: true }`; si no llega, se estima por tokens). Así no se
escapa ninguna llamada: reintentos y helpers sin bucket (`offShoppingList`) incluidos.
`enforceUserRateLimit` lo mira también en la entrada, para cortar con 429 antes de hacer trabajo.
Mismo `RateLimitError` (su `scope` `day`/`month` cambia el mensaje) y mismo "dejar pasar" con log si
falla la base de datos. Ojo con `streamText`: un error del middleware no llega a `result.text`
(rechaza con un genérico), solo a `onError` — por eso `askForJson` lo captura ahí y no reintenta.
Lógica pura y testeada en [src/lib/ai-spend.ts](src/lib/ai-spend.ts). **Excepción deliberada:**
la descomposición de platos va con `createAiProvider(key, userId, { capScope: "month" })` y
`generateDailyGuide` entra con `enforceUserRateLimit(…, "guide", "month")`: el tope DIARIO no las
corta (el mensual sí), porque dejar un plato sin calcular rompe D13 y cuesta céntimos. Siguen
sumando al gasto y a las cuotas por hora; el texto de la guía sí respeta el tope diario.

**Límites: alcance de la IA y contenido de la persona** (spec en
`.scratch/limites-ia-y-contenido/`, explicación larga en AGENTS.md). Dos límites, cada uno con
dos redes:

- **El coach solo se dedica a la alimentación.** La regla de alcance vive en `coachSystemPrompt`
  ([src/lib/ai-provider.server.ts](src/lib/ai-provider.server.ts)), así que la heredan todas las
  superficies (chat, guía, plan, briefing, repaso nocturno). Antes de esa llamada,
  `offTopicReason` ([src/lib/coach-scope.ts](src/lib/coach-scope.ts)) corta en
  [src/routes/api/chat.ts](src/routes/api/chat.ts) lo más común y más caro de dejar pasar —
  pedirle que se salte sus instrucciones o que escriba código — y contesta un mensaje fijo sin
  gastar cuota ni dinero. Todo el texto libre del perfil entra al prompt por `asPromptData`,
  envuelto en «» y declarado como dato: sin eso, `actualizar_perfil` (herramienta del chat) es
  una vía para inyectar instrucciones permanentes en el system prompt.
- **Lo que se escribe como comida tiene que ser comida.**
  [src/lib/content-guard.ts](src/lib/content-guard.ts) (puro, testeado, copia en
  `mobile/lib/content-guard.ts`) compara **por token entero, nunca por subcadena** — si no,
  "cacahuete", "cacao", "penne" y "queso de tetilla" se caen — y `assertCleanFood` va en los
  `.validator()` de `setPlanMeal`, `setChildMeal`, `setPantryExtra`, el `cleanText` de los
  snacks y el `actual` de `propagateLogToFamily`. Por `apiPost`, eso cubre web, móvil y las
  herramientas del coach de una vez. La segunda red no cuesta llamadas nuevas: `resolveDish` y
  `decomposeDishes` devuelven ya `comida`/`isFood`, que coge lo que una lista no puede.

Dos cosas que conviene no romper: ante la duda se **deja pasar** (un falso positivo impide
apuntar lo que de verdad se comió, y eso es peor), y el guard de los **nombres**
(`assertCleanName` en `household.ts` y `daily.ts`) avisa pero **no es frontera**, porque esas
escrituras van del navegador directo a Supabase (ver `.scratch/limites-ia-y-contenido/issues/`).

## Convenciones de código

- Alias de imports: `@/*` apunta a `src/*` (ver `tsconfig.json` y `components.json`).
- Componentes de UI: shadcn/ui, estilo `new-york`, iconos de `lucide-react`, en
  `src/components/ui/`.
- Formato: Prettier (`printWidth` 100, comillas dobles, `;` siempre) — corre `bun run format`
  antes de dar algo por terminado.
- El código de la app móvil vuelve a convertir la misma paleta de color de la web (definida como
  `oklch()` en `src/styles.css`) a hex en `mobile/tailwind.config.js`, porque React Native no
  entiende `oklch`. Si cambias un color en la web, hay que replicarlo ahí a mano — son dos copias.
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
