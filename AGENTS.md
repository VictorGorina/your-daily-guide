# Senda

App de coach de salud y alimentación. TanStack Start + React + TypeScript + Tailwind + Supabase.
La IA (chat del coach, guía diaria, plan mensual) usa OpenRouter (modelo `google/gemini-2.5-flash`
por defecto) a través de `@openrouter/ai-sdk-provider`
(ver [src/lib/ai-provider.server.ts](src/lib/ai-provider.server.ts)); requiere `OPENROUTER_API_KEY` en `.env`.

El modelo se queda deliberadamente en la gama barata: cuando la calidad de una salida flojea, la
respuesta es **sacar el trabajo verificable del modelo hacia código**, no subir de modelo. Primer
ejemplo: las **kcal y macros** ya no las estima el modelo — `src/lib/nutrition/` descompone cada
plato en ingredientes (una llamada) y los suma contra una tabla de composición estática. Ver
"Macros y kcal — deterministas" en CLAUDE.md y `.scratch/nutricion-determinista/`.

## API HTTP (`/api/v1/*`)

Cada server function está expuesta además como ruta HTTP bajo
[src/routes/api/v1/](src/routes/api/v1), porque React Native no sabe llamar server functions de
TanStack Start (dependen del bundle web) y la app nativa necesita HTTP normal.

La ruta **no** duplica la lógica: invoca la misma server function que usa la web mediante
`apiPost` ([api-route.server.ts](src/lib/api-route.server.ts)). El middleware de auth lee la
cabecera `Authorization` de esa petición HTTP, así que la sesión, el `inputValidator` y las
políticas RLS son idénticos por los dos caminos — un único sitio donde vive cada operación.
Añadir una operación nueva a la API son tres líneas; no hay que tocar la lógica.

Códigos que devuelve `apiPost`: `401` si falta la sesión o el token no vale, `400` si el cuerpo no
es JSON, `200` con el resultado, y `500` con `{"error": mensaje}` en cualquier otro fallo. Ojo con
ese 500: los validadores y las reglas de negocio lanzan `Error` con mensajes pensados para
enseñarse en pantalla ("Mes no válido"), indistinguibles de un fallo real, así que el cliente debe
guiarse por el campo `error` y no por el código.

## Platos del plan: cambio a mano vs. recolocación

Dos caminos distintos, deliberadamente separados:

- `setPlanMeal` ([plan.functions.ts](src/lib/plan.functions.ts), herramienta `cambiar_plato` del
  coach) cambia **un** plato de **un** día, de hoy en adelante, escribiendo literalmente lo que ha
  pedido la persona: sin IA de por medio, así "cámbiame el desayuno de mañana" se aplica de verdad
  y es verificable.
- `adjustMonthlyPlan` recoloca **varios** días futuros para compensar (comió de más, salió a
  correr). Ahí el día de hoy sigue fijado.

  La IA devuelve una **lista de cambios** (`{"intro", "cambios": [{"fecha","comida","cena"}]}`),
  no el plan entero: `cleanReflowChanges` la valida contra las fechas editables y
  `applyPlanChanges` la escribe en la celda que toca. Antes se le pedían las cuatro semanas de
  vuelta y devolvía el plan copiado tal cual casi siempre — mucho texto de salida para mover dos
  cenas. El prompt lleva el plan **anotado con la fecha de cada día** y la lista explícita de
  fechas que puede tocar. Si el desvío en kcal (`kcalDelta`, que le llega desde el cambio de plato
  en Hoy) supera `FORCE_ADJUST_KCAL` y aun así no cambia nada, se le insiste una vez; si sigue sin
  mover nada queda en el log y la pantalla lo dice con la cifra, en vez de afirmar que el plan
  estaba equilibrado.

`generateMonthlyPlan` solo planifica de hoy en adelante: su `.validator` rechaza los meses
pasados (no se pueden cumplir y gastan tokens) y el mes que viene hasta su última semana
(`isNextMonthUnlocked`, umbral `NEXT_MONTH_UNLOCK_DAYS = 7` en `plan-shared.ts`, compartido con el
aviso push de renovación). El mes en curso ya arranca en el día de hoy vía `monthCoverage`. La
pantalla Plan tiene un navegador de meses `‹ mes ›` que gobierna calendario e ingredientes; su
suelo es `profiles.app_started_on`. La antigua subpestaña Historial se fundió en el calendario del
mes (semáforo por día + `day-detail-sheet.tsx`).

El plan base deja desayunos y snacks a nivel de semana (una lista que rota por día), así que un
cambio para un día concreto se guarda en campos propios del día — `breakfast`/`snack` en `PlanDay`
([plan-shared.ts](src/lib/plan-shared.ts)) — y manda sobre la rotación. `mergeFuturePlan` los
conserva: una recolocación automática posterior no pisa lo que se pidió a mano.

**La rejilla del plan no va en orden de calendario.** La semana la marca el día del mes
(`floor((día-1)/7)`) y la posición dentro de la fila, el día de la semana. En un mes que empieza en
martes, la semana 0 va martes(día 1)…domingo(día 6) y luego lunes(día 7): el lunes es la ÚLTIMA
fecha de esa semana pero ocupa la posición 0. Qué fecha ocupa cada celda lo dice `dateOfPlanCell`
(la inversa de `planSlotIndex`), y es lo único con lo que se puede decidir si una celda se puede
reescribir. `mergeFuturePlan`/`mergeFutureKids` lo comparaban por posición y en un lunes eso
reescribía los días 1 al 6 —ya pasados— sin tocar ninguno futuro: el ajuste se aplicaba donde no se
veía, y parecía que el coach no hacía nada. Los días 29 en adelante comparten celda con la semana
3; `dateOfPlanCell` devuelve la primera fecha de la fila, de forma que el empate se resuelve a
favor de no tocar nada.

La lista de la compra **nunca** cambia. Si el plato pide algo que no se compró, se guarda igual y
los ingredientes que faltan quedan en `PlanDay.extras[comida]`, que se pintan como aviso ("Fuera de
tu compra: ...") en Hoy y en el calendario del plan. Quién falta lo decide el modelo
(`offShoppingList`), porque casar texto libre con la lista a ojo no funciona ("pechuga de pollo" lo
cubre "pollo"); si esa comprobación falla no se marca nada, mejor no avisar que avisar en falso.

**Cantidades — modelo canónico por semana.** El problema antiguo: `qty` era texto libre que la IA
inventaba fila a fila, sin que nadie lo sumara ni validara, así que la misma comida podía pedir
1 kg de cebolla en una cadencia y 1,5 kg (troceado) en otra, y el reparto de emergencia
(`repartitionTrips`) movía filas enteras sin tocar la cantidad. Ahora `generateMonthlyPlan` guarda
`shopping` en forma **canónica**: una fila por ingrediente con `unit` (`g`/`ml`/`ud`), `weekQty`
(cantidad que piden los platos de cada una de las 4 semanas del plan) y `weekPrice`. La IA no
asigna compras ni escribe `qty`. `projectTrips` ([plan-shared.ts](src/lib/plan-shared.ts)) deriva
la vista por compra: para cada compra suma la parte de `weekQty`/`weekPrice` de los días que cubre
(`tripDayRange`, repartiendo la cantidad de cada semana entre SUS días reales vía `weekDayCounts` —
la última semana de un mes de 31 días arrastra 10 días, no 7). Invariante: **Σ de todas las compras
= lo que necesita el mes**, y cambiar de cadencia solo re-trocea ese total. La forma proyectada
lleva además `qtyValue` (número, para sumar sin re-parsear `qty`). Reglas al tocar esto: no vuelvas
a meter aritmética de cantidades en el prompt, no escales `price_eur` sin escalar la cantidad, y
mantén el test de invariante en `plan-shared.test.ts`.

**Perecederos — sesgar y avisar, no reestructurar.** Un fresco no se puede comprar de golpe para
todo un mes. `shelfLifeDays` ([perishability.ts](src/lib/perishability.ts)) da la vida útil por
palabra clave/categoría; `freshRisksForTrip` marca los frescos de una compra cuyo tramo de días la
supera, y la UI lo pinta como aviso `bg-warning/20` ("cómpralos más cerca de cuando los cocines").
El prompt de cadencia mensual sesga hacia ingredientes de larga vida. Decisión deliberada: **no**
se añade una compra extra de frescos a media de mes ni se cambia la lista — solo se avisa.

**Despensa extra (`monthly_plans.pantry_extras`).** Ingredientes que la persona ya tiene en casa y
que la lista de la compra no incluye: los añade a mano en la pestaña Ingredientes (`setPantryExtra`)
o salen del escaneo de un tiquet (`scanTripReceipt`, solo los que encajan con sus objetivos; el
resto se descartan con motivo). Es un conjunto **paralelo** a `shopping` — nunca se fusiona con la
lista de la compra — que `adjustMonthlyPlan`, `setPlanMeal`/`offShoppingList` y `coachPlanContext`
tratan como también disponible al recolocar. El importe real del tiquet se guarda en `trip_actuals`
(misma columna que el gasto a mano) y su resumen en `trip_receipts`; de ahí sale la tarjeta "Gasto
en comida" del historial (`MonthSpendSummary`). La foto del tiquet no se guarda: se manda al modelo
de visión y se descarta.

**Recálculo automático del plan (issue 05).** Antes un cambio en la despensa extra o en la mesa no
tocaba el plan ("no dispara regeneración"); el usuario lo revirtió el 2026-09-07. Ahora
`schedulePlanRecalc` ([src/lib/plan-recalc.ts](src/lib/plan-recalc.ts), copia en
`mobile/lib/plan-recalc.ts`) programa un recálculo **silencioso** tras un cambio de despensa
(`onSuccess` de `pantry`/`receipt` en la pantalla Plan) o de mesa (`addAdult` / `dropMember` /
`setMemberPortion` / `ChildSheet` en Familia). Es por evento, nunca por tiempo. Un debounce de ~6 s
en el cliente agrupa varios cambios seguidos en **una** llamada a `POST /api/v1/plan/reflow`
(`reflowMonthlyPlan`), para no vaciar la cuota; se persiste un "pendiente" en storage y la pantalla
Plan lo relanza al abrirse si la app se cerró antes de que saltara el debounce
(`flushPlanRecalc`). `reflowMonthlyPlan`:

- `scope: "meals"` (despensa) → `reflowMeals` (núcleo que también usa `adjustMonthlyPlan`): recoloca
  platos futuros, la lista de la compra **no** cambia.
- `scope: "full"` (mesa) → `generatePlanBody` regenera plan y cantidades con el hogar nuevo, luego
  `mergeFuturePlan` + `mergeFutureKids` (conservan hoy/pasado, un plato a mano y adoptan los purés de
  un bebé nuevo) y `carryOwnedCanonical` (traspasa "en casa"/"comprado" por nombre). `confirmed_at`
  se limpia. Esta es la única vía por la que un cambio del sistema mueve las cantidades de la compra.
  Guardas: solo el planificador (o quien va en solitario) ejecuta el recálculo — para un no
  planificador `reflowMonthlyPlan` devuelve `skipped: "not-planner"` sin gastar cuota. Bucket propio
  `plan-reflow` (12/h) en `RATE_LIMITS`.

Cambiar de cadencia (`recadenceMonthlyPlan`) en una lista **canónica** no llama a la IA ni toca
`shopping`: solo guarda la nueva cadencia y la UI re-proyecta. En una lista **antigua** sí rehace
el reparto de `trip` (`repartitionTrips`) y puede trocear un perecedero en varias filas;
`carryOwnedByName` (`plan-shared.ts`) reaplica "en casa"/"comprado" por nombre para que las marcas
no se pierdan. Las listas antiguas se convierten a canónicas al regenerar el plan.

Para que el coach pueda proponer platos con lo ya comprado, cada mensaje del chat lleva la lista de
ingredientes, la despensa extra y el menú de los próximos días (`coachPlanContext`), además de la
fecha de hoy — sin ella el modelo no puede convertir "mañana" en la fecha que necesita la
herramienta.

## Familia — hogar compartido

La pestaña Familia (`/hogar`) modela una casa donde varias personas comen el mismo plato. El
spec largo, con las decisiones cerradas con el usuario (D1–D5), vive en
[.scratch/familia-comidas-compartidas/](.scratch/familia-comidas-compartidas/); esto es el
resumen de lo que no se puede romper.

**`household_members` son huecos de la mesa, no filas de usuario.** `id` es la PK; `user_id`
es NULL-able (`NULL` = hueco sin reclamar, o adulto que no usa la app pero cuenta para la
compra); `display_name` lo pone quien crea la familia al declarar la mesa; `portion` es el
peso de ración. "Un hogar por persona" se mantiene con un índice parcial
`UNIQUE (user_id) WHERE user_id IS NOT NULL`. Quien se une ya no inserta una fila: mete el
código, elige su hueco de una lista de nombres (`household_open_slots` /
`claim_household_slot`) y el `UPDATE` le pone su `user_id`. Los niños siguen en
`household_children` (sin cuenta, con `portion` por edad).

**Un solo planificador.** `household_members.is_planner` — exactamente uno `true` por hogar,
lo garantiza un trigger. El plan y la lista de la compra de ese miembro **son los del hogar**
para todas las comidas compartidas, dimensionados para todos los comensales. Si el
planificador sale del hogar o borra su cuenta, otro trigger (`AFTER DELETE`) pasa
`is_planner` al miembro con cuenta de más edad (`date_of_birth` → `age` → `created_at`); no
hay que llamar a nada desde el código de aplicación (D3).

**Una sola configuración de comidas compartidas, a nivel de hogar.** `households.shared_slots`
(`{desayuno,comida,cena: number[]}`, 0=lunes…6=domingo) dice qué comida de qué día es "el
mismo plato para toda la mesa". Sustituye al viejo `household_members.shared_meals` por
miembro y a la lógica de intersección (`sharedDays`), que ya no existen. Solo el planificador
la edita; el resto la ve en lectura (D2). Los snacks nunca se comparten (D5).

**Cada adulto con cuenta sigue teniendo su fila `monthly_plans` (D1).** No es todo suyo: los
slots compartidos de esa fila son un **espejo de solo lectura** del planificador, y los no
compartidos (sus desayunos si el finde no se comparte, sus snacks) los genera y edita él.
La composición es en vivo al leer — `composeDayForUser` / `composeMonthlyPlanForMember`
([plan-shared.ts](src/lib/plan-shared.ts)) mezclan las dos filas día a día — y hacia adelante
al escribir, con `syncSharedMeals` ([household.server.ts](src/lib/household.server.ts)), que
**siempre** toma como fuente la fila del planificador. `fetchMonthlyPlan`
([daily.ts](src/lib/daily.ts)) es el único punto donde se compone: Hoy, el calendario del
plan, el contexto del coach y el repaso nocturno lo consumen por la misma query
`["plan", month]`. `generateMonthlyPlan` tiene un modo "solo mis slots" para un no
planificador (`blankSharedSlots` vacía los slots compartidos y la rotación de desayuno). Un
no planificador que pida cambiar una comida compartida —desde la UI o el coach— recibe un
aviso y no se toca nada (`guardSharedSlotWrite`).

**El estado de la compra sí es de todos.** Marcas "en casa"/"comprado", gasto real, tiquets,
despensa extra y cierre de tramos los edita cualquier miembro con cuenta sobre la lista del
planificador. En `plan.functions.ts`, `resolveShoppingRow` decide la fila objetivo
(`householdPlannerId`, una sola consulta) y `readShoppingRow` / `writeShoppingState` la leen
y escriben: si el que llama no es el planificador, con `supabaseAdmin` (RLS solo le deja
LEER esa fila) y **solo** columnas de estado, nunca `plan` ni `weekQty`. La pantalla Plan de
un no planificador muestra "La compra de la casa" (la del planificador, operable: navegador
de compras y modo súper propios) encima de "Tu compra en solitario" (la suya).

**Plato aparte de un niño.** Cuando un plato compartido no le sirve a un niño (su alérgeno,
su edad, no lo come), el plan lleva `PlanDay.kids` (`{childId, slot, dish, off?}`): lo emite
la IA al generar (`generateMonthlyPlan`) o lo cambia el planificador a mano con `setChildMeal`
(paralela a `setPlanMeal` — hoy y el pasado bloqueados, la compra no cambia, lo que falte va
en `kids[].off`; ruta espejo `/api/v1/plan/child-meal`). Es parte del plan compartido: solo
el planificador lo toca (D2) y `syncSharedMeals` / `composeDayForUser` lo arrastran con su
comida compartida. Solo las 3 comidas principales — el snack nunca.

**Bebés que aún no comen de la mesa.** `household_children.feeding_stage` (`pecho` ·
`triturados` · `mesa`, default `mesa`; migración `20260906150000`) separa esa etapa. Sin
esto, un bebé de 2 meses se daba de alta como un peque más: contaba como comensal del plato
compartido, inflaba la compra de la casa y la IA lo planificaba comiendo lo mismo que la
mesa. `eatsTableFood(stage)` / `childRation(stage, age, appetite)` en
[household-shared.ts](src/lib/household-shared.ts) sacan a los no-`mesa` de
`servingsPerSlot`, `servingsForMealDay`, `deriveSharedSlots`/`isEffectivelyShared` y
`whoIsHome` — no dimensionan el plato de la mesa ni la compra. `pecho` no lleva plato ni
ingredientes; `triturados` lleva SIEMPRE su propio plato en `PlanDay.kids` cada día que come
en casa (puré sin sal, ración pequeña, sus ingredientes al `weekQty`). El prompt de
`generateMonthlyPlan` y `describeRoster` distinguen las dos categorías. UI: selector "¿Qué
come?" en `child-sheet.tsx` (oculta Apetito si no es `mesa`), y Familia agrupa a los bebés
bajo "Bebés · aún no comen de la mesa". `selectWithOptionalColumns`
([household.server.ts](src/lib/household.server.ts)) tolera la columna sin migrar.

**El coach conoce la mesa.** `householdContext` (roster con raciones vía `describeRoster`,
`shared_slots`, niños con alergias, quién planifica) alimenta `generateMonthlyPlan`,
`adjustMonthlyPlan`, `welcomeBriefing` y también `/api/chat`, que para leerlo con las
políticas del usuario usa `supabaseFromRequest` ([api-auth.server.ts](src/lib/api-auth.server.ts))
— un cliente Supabase de servidor ligado al Bearer de la petición. Cuando `actions` está
activo, `householdCoachRules` le dice al coach qué puede cambiar cada persona (el planificador
usa `cambiar_plato_nino` para los niños; un no planificador solo toca sus comidas en
solitario). Los `.server.ts` y los guards del servidor son la barrera real; el prompt solo
evita que el coach prometa lo que no puede hacer.

**RLS — cuidado con las lecturas de `monthly_plans`.** La policy de SELECT que deja a un
miembro leer la fila del planificador hace que cualquier `.maybeSingle()` sin
`.eq("user_id", …)` explícito devuelva 2 filas para un no planificador y lance `PGRST116`.
En server functions se usa el helper `ownPlanRow`; en `daily.ts`, `fetchOwnMonthlyPlan`.

## Push notifications

Web Push real (VAPID) vía [`@pushforge/builder`](https://github.com/draphy/pushforge) — usa solo
Web Crypto API, así que funciona en Cloudflare Workers (el `web-push` de npm no, depende de
`crypto.createECDH()` que Workers no soporta). Requiere en `.env`: `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` (servidor, par generado con `bun x pushforge vapid`), `VITE_VAPID_PUBLIC_KEY`
(cliente, mismo valor que la pública), y `CRON_SECRET` (protege `/api/cron/dispatch`, ver abajo).

El disparo periódico **no** usa el `scheduled` nativo de Cloudflare Workers — este proyecto
sustituye el entry-point autogenerado de Nitro por [src/server.ts](src/server.ts), que solo
expone `fetch`, así que enganchar ahí un Cron Trigger de Cloudflare es incierto sin desplegar y
probar. En su lugar, un workflow de GitHub Actions
([.github/workflows/push-dispatch.yml](.github/workflows/push-dispatch.yml)) llama cada 15 min a
`POST /api/cron/dispatch` (protegido por `x-cron-secret`), que reutiliza
[src/lib/push-dispatch.server.ts](src/lib/push-dispatch.server.ts) para mirar qué perfiles caen en
la ventana de su `morning_time`/`evening_time` — cada uno evaluado contra su propia
`profiles.timezone` (detectada del dispositivo; ver [src/lib/zoned-date.ts](src/lib/zoned-date.ts)) —
y enviar el push.
Necesita los secrets de repo `APP_URL` y `CRON_SECRET` en GitHub una vez desplegada la app.

El copy de mañana/noche y la frecuencia de contacto varían según `profiles.tone`
(relajado/neutro/exigente, ver `morningCopy`/`eveningCopy` en
[push-dispatch.server.ts](src/lib/push-dispatch.server.ts)): tono relajado se salta el push de la
noche si el día ya está completo (menos ruido cuando no hace falta), exigente siempre lo recibe y
nombra cuántas comidas quedan por registrar. Mismo tono, aplicado también en el repaso nocturno
(`NightlyReviewSheet`) y en el prompt del coach (`toneLine` en
[ai-provider.server.ts](src/lib/ai-provider.server.ts)) — tres superficies distintas, un solo campo
de perfil.
