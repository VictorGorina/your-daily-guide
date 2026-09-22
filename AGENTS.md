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

## Picoteo en Hoy (`picoteo-hoy`)

Botón "Añadir picoteo" justo encima de "Registrar deporte", en web y móvil. Spec y decisiones en
`.scratch/picoteo-hoy/spec.md`. Tres piezas:

- **Calcular antes de guardar.** `estimateSnack` descompone el texto con `dishToIngredients` (la
  misma llamada barata que la guía) y suma contra la tabla de composición; la hoja
  (`snack-sheet.tsx`) enseña "≈ 175 kcal" y deja corregirla (lo que pone el envase: el resto de
  macros se escala con `scaleSnackMacros` y la entrada queda `source: "manual"`). Por debajo de
  0,4 de calidad no hay cifra — la hoja pide las kcal a mano en vez de inventarlas con el genérico —
  y entre 0,4 y 0,7 avisa de revisarla. La tabla tiene filas propias de picoteo (patatas de bolsa,
  cerveza, bollería, gominolas…) y el prompt anclas de ración ("onza" = cuadradito de tableta, no
  la onza inglesa: sin eso "dos onzas" salían 57 g).
- **Columna propia `daily_logs.snacks`** (`DaySnacks` en `src/lib/snacks.ts`, copia en móvil), no
  dentro de `habits`: `reconcileHabits` reconstruye `habits` desde el plan en cada carga y lo
  borraría, y así un picoteo no cuenta en el semáforo. Solo la escriben `logSnack`/`removeSnack`/
  `settleDay` en servidor, con escritura optimista sobre `updated_at` (se relee y reintenta si se
  cruza otra escritura de la fila). Suma en la barra de macros de Hoy y en `DayDetailBody`
  (sección "Picoteo").
- **Compensación decidida en código, y con el día entero** (ver `balance-del-dia` más abajo; esta
  sección describe la mecánica, que sigue igual, pero la decisión ya NO es solo del picoteo).
  `compensatedKcal` es un libro de cuentas: lo pendiente es `Σ kcal − compensatedKcal`. Tras 10 s de
  calma (`day-settle.ts`, misma forma que `plan-recalc.ts`: pendiente persistido, flush al ocultar,
  relanzado al abrir Hoy) el cliente llama a `POST /api/v1/day/settle` solo con `{today}`; el
  servidor relee, **suma el picoteo con los cambios de plato y el deporte** (`dayBalance`) y decide
  con
  `compensationNeed` (`src/lib/nutrition/compensation.ts`, la tabla aprobada de
  `hoy-semanas-editables`: perder +200/−400, mantener ±200, ganar +400/−200; embarazo o lactancia
  nunca recorta). Si toca, **reserva** el pendiente antes de llamar a la IA (dos asentamientos a la
  vez no compensan lo mismo) y llama a `reflowMeals` con `window` = `compensationWindow` (mañana a
  hoy + 6, dentro del mes, solo fechas con una comida o cena propia y que sean la fecha real de su
  celda) y `soloOnly: true` (tampoco quien planifica toca las compartidas: un picoteo es personal).
  Si el reajuste no mueve ningún plato se devuelve la reserva y cuenta como fallo, para no dar por
  compensado lo que no lo está. Borrar (o reducir) un picoteo ya compensado deja un pendiente
  negativo: como no es un déficit real sino deshacer un ajuste que ya no tiene motivo, no se le
  aplica el umbral "a favor" del objetivo (el `−400` de perder, pensado para dejar pasar un déficit
  genuino) — `compensationNeed({ reversing: true })` compara con el mismo umbral que hizo falta para
  aplicar la compensación (`+200`/`+400`), para que sumar y quitar el mismo picoteo sea simétrico.
  Los motivos para no reajustar (`no-days`, `shared-only`, `no-meals`, `no-plan`, `pregnancy`) se
  enseñan en la tarjeta "Balance de hoy" (`dayOutcomeNote`), una sola vez para el día.

El asentamiento no cambia nunca la compra, hoy ni el pasado. `composeDayForUser` conserva el array
`kids` si el conjunto no cambia, para que congelar las compartidas no reescriba días pasados solo
por reordenarlo. El registro guiado del chat sigue yendo por el coach (`ajustar_plan_mensual`).

## Balance del día (`balance-del-dia`)

Un solo asentamiento por ráfaga en vez de tres, y una tarjeta en Hoy que enseña el efecto. Spec y
decisiones en `.scratch/balance-del-dia/spec.md`; el porqué largo, con los dos fallos que arregla,
está en la cabecera de `src/lib/day-balance.ts`.

En corto: cambiar un plato, picotear y hacer deporte tenían cada uno su libro de cuentas, su
debounce de 10 s, su llamada a `compensationNeed` y su llamada a `reflowMeals` — los tres sobre la
MISMA ventana de 6 días, sin hablarse. Por separado cada función era correcta; el fallo era el
átomo. **La energía se suma en el cuerpo, no por origen.** Picotear +250 y quemar −300 (un día a
−50, o sea nada) lanzaba dos recolocaciones opuestas; un cambio de +120 con un picoteo de +110
(+230, por encima del umbral) no movía nada. Ahora `settleDay` suma el día (`dayBalance`), decide
una vez y llama una vez.

Cosas que un cambio suele romper sin querer:

- **No devuelvas la decisión a cada origen.** Los tres libros (`habits[].swapKcalDelta`,
  `snacks.compensatedKcal`, `exercise.compensatedKcal`) se quedan porque son la procedencia — el
  desglose que la tarjeta enseña — y porque garantizan no compensar dos veces. Pero quien decide es
  `settleDay` con la suma.
- **`net` (lo que se enseña) y `pending` (lo que decide) son distintos** en cuanto algo ya se
  compensó, igual que `snackTotals` frente a `pendingSnackKcal`. Y un plato deshecho deja un
  `swapKcalDelta` contrario que cuenta para decidir pero NO para enseñar (`changedMealsKcal` filtra
  por `status === "distinto"`): si contara, deshacer un plato de +300 enseñaría "−300".
- **El resultado es del día, no del origen.** Vive una sola vez en `daily_logs.adjustment`. No
  vuelvas a escribirlo en `snacks.adjustment`, `exercise.adjustment` ni
  `habits[].adjustmentChanges` — esos tres se siguen LEYENDO para días anteriores a la feature
  (`dayMovedChanges`), pero ya no se escriben. El badge "i" por comida se quitó porque mentía: el
  servidor escribía la misma lista en todas las comidas del lote.
- **La cadencia es corta a propósito.** Se descartó un cierre nocturno, que sería más exacto, porque
  la persona tiene que ver el efecto mientras sigue en la app. Varias pasadas en un día no se pisan
  porque `mergeDayAdjustment` las acumula.
- **La columna `adjustment` puede no existir todavía** (migración de panel): `readDayRow` detecta el
  42703 una vez y sigue sin ella. Se compensa igual; solo no se puede enseñar lo movido.
- `/api/v1/snacks/settle` y `/api/v1/exercise/settle` se conservan como alias de `day/settle` para
  las builds móviles ya instaladas.

**Editar el picoteo de un día pasado (2026-09-19) es solo corregir el historial.** La sección
"Picoteo" de `DayDetailBody` (calendario de Plan y tira de Hoy) deja de ser de solo lectura: una X
por entrada y un botón "Añadir picoteo" abren el mismo `SnackSheet` con la fecha de ese día
(`logSnack`/`removeSnack` ya aceptaban cualquier fecha; el cambio es de UI). A propósito **no**
llama a `settleSnacks`: el asentamiento recoloca días posteriores a HOY, y un día pasado no tiene
ninguno que tenga sentido tocar — igual que corregir una comida con `updateLogByDate` no mueve kcal.
(El asentamiento se llama ahora `settleDay`; el criterio no cambia.)
`SnackSheet` gana un prop `pastDay` que cambia el copy para no prometer un reajuste que no llega.

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

## Límites: alcance de la IA y contenido de la persona

Feature `limites-ia-y-contenido` (spec y decisiones en `.scratch/limites-ia-y-contenido/`). Son
dos límites independientes, y cada uno tiene **dos redes** porque ninguna sola aguanta.

### El coach solo se dedica a la alimentación

El alcance es **amplio a propósito**: dentro entra la comida y también lo que la rodea (horarios,
ejercicio, ánimo, sueño, presupuesto) siempre que se hable para explicar o ajustar la
alimentación. Un alcance estricto de "solo platos" habría contradicho lo que el onboarding ya
promete con `coach_scope`, y habría dejado al coach seco justo donde más ayuda.

La regla vive en `coachSystemPrompt` y solo ahí: la heredan el chat, la guía diaria, el plan
mensual, el briefing de bienvenida y el repaso nocturno. Si se añade una superficie de IA nueva,
hereda el límite sin tocar nada — siempre que use ese prompt.

Delante va un corte determinista (`offTopicReason`, `src/lib/coach-scope.ts`) sobre el último
mensaje, **antes** de `enforceUserRateLimit` y de `streamText`: un intento de saltarse las
instrucciones o de pedir código no gasta ni cuota ni dinero. Se responde con
`createUIMessageStream`, no con un error HTTP, para que el chat lo pinte como un turno normal.
La lista de patrones es corta y casi siempre pide **dos** señales (un verbo de petición y un
sustantivo técnico): "¿cuál es mi código de invitación?" es una pregunta legítima del hogar y no
puede caerse. Lo que se escape a esa lista lo para igualmente el prompt.

El tercer trozo es el menos obvio y el más importante: `asPromptData`. `coachSystemPrompt`
interpolaba en crudo `life_context`, `restrictions`, `past_struggles` y compañía, y la
herramienta `actualizar_perfil` del chat deja **escribir** esos campos. Sin fencing, alguien
guarda "ignora tus instrucciones" en su perfil y queda inyectado en el system prompt de todas las
superficies, en todas las llamadas, para siempre. Ahora cada valor entra recortado, sin saltos de
línea ni fences, envuelto en «» y con una línea del prompt que dice que lo que va entre «» es un
dato sobre la persona y nunca una instrucción.

### Lo que se escribe como comida tiene que ser comida

Hace falta porque un plato no es efímero: se guarda en `monthly_plans.plan`, se ve todo el mes en
Hoy y en el calendario, se espeja al resto del hogar con `syncSharedMeals` y vuelve a entrar en
los prompts. Nadie lo corrige después.

`src/lib/content-guard.ts` es lógica pura y testeada, con copia en `mobile/lib/content-guard.ts`
(convención del repo: copias, no paquete compartido). Lo que hay que respetar al tocarlo:

- **Se compara por token entero, nunca por subcadena.** Por subcadena, "caca" se lleva por delante
  `cacahuete` y `cacao`, y "cock" se lleva `cocktail`. El allowlist existe para el caso que rompe
  cualquier implementación ingenua: `penne`, que al colapsar letras repetidas **es** un término
  bloqueado. `tetilla` (el queso), `rabo` (de toro), `cagarria` (la colmenilla) y `chocho` (el
  altramuz) están ahí o deliberadamente fuera de la lista negra por lo mismo.
- **La lista negra es corta y solo tiene términos inequívocos.** `rabo`, `chocho`, `polvo`,
  `leche` y `huevos` son alimentos de verdad y se quedan fuera a propósito; de su uso soez se
  encarga la red semántica, que sí entiende el contexto.
- **Ante la duda, se deja pasar.** Un falso positivo le impide a alguien apuntar lo que de verdad
  ha comido, y la precisión de kcal/macros es la base de la app.

El enforcement va en los `.validator()` — `setPlanMeal`, `setChildMeal`, `setPantryExtra`, el
`cleanText` compartido por `estimateSnack`/`logSnack`, y el `actual` de `propagateLogToFamily`,
que lo ven los demás del hogar. Por `apiPost`, eso cubre la web, la app móvil y las herramientas
`cambiar_plato`/`cambiar_plato_nino` del coach con un solo trozo de código. El chequeo del cliente
es solo para no esperar a la ida y vuelta.

La segunda red no cuesta llamadas nuevas. `resolveDish` ya gastaba una llamada por cada plato
escrito a mano (ortografía + qué falta de la compra); ahora esa misma llamada devuelve también
`"comida": true|false`, y `decomposeDishes` devuelve `isFood` por plato. Solo un `false`
explícito rechaza: si el campo no llega o el modelo falla, se deja pasar, igual que ya hacía la
corrección ortográfica. Ojo con un detalle fácil de romper: en `resolveDish` ese rechazo es un
`ValidationError` que hay que **re-lanzar** desde el `catch`, o el respaldo "guárdalo tal cual" se
lo come.

Caso aparte, el del picoteo: `estimateSnack` devolvía `resolved: false` para algo que no entendía
y la hoja ofrecía **poner las kcal a mano**. Ese respaldo era justo la forma de colar una broma
saltándose el cálculo, así que `SnackEstimate` tiene ahora un `notFood` distinto de `resolved`, y
con él la hoja rechaza en vez de ofrecer el modo manual.

### Nombres: aviso, no frontera

`assertCleanName` (en `src/lib/household.ts` y su copia móvil, más `saveProfile` en `daily.ts`)
cubre el nombre de un miembro de la mesa, el de un peque y `profiles.display_name` — los ve todo
el hogar. Pero esas escrituras van **del navegador directo a Supabase**, sin server function de
por medio, así que ahí no hay ningún validador donde enganchar: el guard avisa y se puede
esquivar con una llamada REST. Cerrarlo de verdad pide un trigger en Postgres o mover esas
escrituras a server functions (ticket `01-trigger-nombres.md`). El deporte no necesita nada:
`EXERCISE_ACTIVITIES` es una lista cerrada.
