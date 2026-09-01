# Senda

App de coach de salud y alimentación. TanStack Start + React + TypeScript + Tailwind + Supabase.
La IA (chat del coach, guía diaria, plan mensual) usa OpenRouter (modelo `google/gemini-2.5-flash`
por defecto) a través de `@openrouter/ai-sdk-provider`
(ver [src/lib/ai-provider.server.ts](src/lib/ai-provider.server.ts)); requiere `OPENROUTER_API_KEY` en `.env`.

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
tratan como también disponible al recolocar. No dispara regeneración: solo cuenta la próxima vez
que se recoloca. El importe real del tiquet se guarda en `trip_actuals` (misma columna que el gasto
a mano) y su resumen en `trip_receipts`; de ahí sale la tarjeta "Gasto en comida" del historial
(`MonthSpendSummary`). La foto del tiquet no se guarda: se manda al modelo de visión y se descarta.

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
la ventana de su `morning_time`/`evening_time` (asumiendo `Europe/Madrid`) y enviar el push.
Necesita los secrets de repo `APP_URL` y `CRON_SECRET` en GitHub una vez desplegada la app.

El copy de mañana/noche y la frecuencia de contacto varían según `profiles.tone`
(relajado/neutro/exigente, ver `morningCopy`/`eveningCopy` en
[push-dispatch.server.ts](src/lib/push-dispatch.server.ts)): tono relajado se salta el push de la
noche si el día ya está completo (menos ruido cuando no hace falta), exigente siempre lo recibe y
nombra cuántas comidas quedan por registrar. Mismo tono, aplicado también en el repaso nocturno
(`NightlyReviewSheet`) y en el prompt del coach (`toneLine` en
[ai-provider.server.ts](src/lib/ai-provider.server.ts)) — tres superficies distintas, un solo campo
de perfil.
