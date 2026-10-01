# Peppers

App de coach de salud y alimentación. TanStack Start + React + TypeScript + Tailwind + Supabase.
La IA (chat del coach, guía diaria, plan mensual) usa OpenRouter (modelo `google/gemini-2.5-flash`
por defecto) a través de `@openrouter/ai-sdk-provider`
(ver [src/lib/ai-provider.server.ts](src/lib/ai-provider.server.ts)); requiere `OPENROUTER_API_KEY` en `.env`.

El modelo se queda deliberadamente en la gama barata: cuando la calidad de una salida flojea, la
respuesta es **sacar el trabajo verificable del modelo hacia código**, no subir de modelo. Primer
ejemplo: las **kcal y macros** ya no las estima el modelo — `src/lib/nutrition/` descompone cada
plato en ingredientes (una llamada) y los suma contra una tabla de composición estática. Ver
"Macros y kcal — receta canónica, no del modelo" en CLAUDE.md, `.scratch/nutricion-determinista/`
y `.scratch/precision-nutricional/`.

## API HTTP (`/api/v1/*`)

Cada server function está expuesta además como ruta HTTP bajo
[src/routes/api/v1/](src/routes/api/v1), porque React Native no sabe llamar server functions de
TanStack Start (dependen del bundle web) y la app nativa necesita HTTP normal.

La ruta **no** duplica la lógica: invoca la misma server function que usa la web mediante
`apiPost` ([api-route.server.ts](src/lib/api-route.server.ts)). El middleware de auth lee la
cabecera `Authorization` de esa petición HTTP, así que la sesión, el `inputValidator` y las
políticas RLS son idénticos por los dos caminos — un único sitio donde vive cada operación.
Añadir una operación nueva a la API son tres líneas; no hay que tocar la lógica. Si la operación
llama al modelo, añade además su ruta a `LONG_ROUTES` de [mobile/lib/api.ts](mobile/lib/api.ts):
el móvil corta el resto a los 30 s.

Códigos que devuelve `apiPost` (siempre con `{"error": mensaje}` salvo el `200`):

| Código | Cuándo                                                          | `error`                   |
| ------ | --------------------------------------------------------------- | ------------------------- |
| `200`  | todo bien (el cuerpo es el resultado)                           | —                         |
| `400`  | el cuerpo no es JSON, o la función lanza `ValidationError`      | el mensaje, para enseñar  |
| `401`  | el mensaje empieza por `Unauthorized` (sin sesión o token malo) | el mensaje; toca reentrar |
| `429`  | `RateLimitError` (cuota o tope de gasto), con `retry-after`     | el mensaje, para enseñar  |
| `500`  | `UserFacingError`: fallo real con texto escrito para la persona | el mensaje, para enseñar  |
| `500`  | cualquier otro `Error` (se registra y va a Sentry)              | un texto genérico         |

Así el cliente puede enseñar **siempre** el campo `error`: lo interno ya llega sustituido por el
genérico. El código sirve para decidir qué hacer (reentrar con 401, esperar con 429), no qué
decir. Del lado del servidor, la clase que se lanza es la que decide: `ValidationError` para un
dato inválido de la persona ("Mes no válido"), `UserFacingError` para un fallo que merece un
mensaje propio ("No hemos podido guardar el horario") y `Error` para lo interno (una clave que
falta, la respuesta de un servicio). La web ve la misma tabla: el middleware
`publicErrorMiddleware` de `src/start.ts` pasa cada error de una server function por
`publicError` (`src/lib/public-error.ts`) y sustituye lo interno por `HiddenServerError`, con el
mismo texto genérico, antes de que TanStack Start lo serialice (ticket 15, SEC-S-14). Hacía
falta: un error de postgrest-js es un objeto plano y viajaba entero al navegador, con `details`
y `hint`. El original queda en `server_fn_failed` y en Sentry.

## Platos del plan: cambio a mano vs. recolocación

Dos caminos distintos, deliberadamente separados:

- `setPlanMeal` ([dishes.functions.ts](src/lib/plan/dishes.functions.ts), herramienta `cambiar_plato` del
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
(`isNextMonthUnlocked`, umbral `NEXT_MONTH_UNLOCK_DAYS = 7` en `plan/month.ts`, compartido con el
aviso push de renovación). El mes en curso ya arranca en el día de hoy vía `monthCoverage`. La
pantalla Plan tiene un navegador de meses `‹ mes ›` que gobierna calendario e ingredientes; su
suelo es `profiles.app_started_on`. La antigua subpestaña Historial se fundió en el calendario del
mes (semáforo por día + `day-detail-sheet.tsx`).

El plan base deja desayunos y snacks a nivel de semana (una lista que rota por día), así que un
cambio para un día concreto se guarda en campos propios del día — `breakfast`/`snack` en `PlanDay`
([plan/types.ts](src/lib/plan/types.ts)) — y manda sobre la rotación. `mergeFuturePlan` los
conserva: una recolocación automática posterior no pisa lo que se pidió a mano.

**Comidas fijadas.** Un cambio a mano (`setPlanMeal`, que escribe con `withPlanMeal`) queda
**fijado** en `PlanDay.pinned`: ninguna recolocación automática lo pisa (`applyPlanChanges`,
`mergeFuturePlan`, y el prompt de `reflowMeals` lo marca como `"fijo"`). Hace falta porque comida
y cena viven en los mismos campos (`lunch`/`dinner`) que escribe la IA; antes solo sobrevivían
desayuno y merienda (`breakfast`/`snack`, que además mandan sobre la rotación semanal).
"Deshacer" manda `pin: false` con el `previousPinned` que devuelve `setPlanMeal`. En el hogar, la
marca de una comida compartida viaja con el plato del planificador (`mirrorPinned`); para decidir
algo en la UI por "este plato se cambió a mano" se usa `isPinnedByViewer` (ver "Familia").

**La rejilla del plan no va en orden de calendario.** La semana la marca el día del mes
(`floor((día-1)/7)`) y la posición dentro de la fila, el día de la semana. En un mes que empieza en
martes, la semana 0 va martes(día 1)…domingo(día 6) y luego lunes(día 7): el lunes es la ÚLTIMA
fecha de esa semana pero ocupa la posición 0. Qué fecha ocupa cada celda lo dice `dateOfPlanCell`
(la inversa de `planSlotIndex`), y es lo único con lo que se puede decidir si una celda se puede
reescribir. `mergeFuturePlan`/`mergeFutureKids` lo comparaban por posición y en un lunes eso
reescribía los días 1 al 6 —ya pasados— sin tocar ninguno futuro: el ajuste se aplicaba donde no se
veía, y parecía que el coach no hacía nada. Los días 29-31 van en una 5.ª fila (`PLAN_ROWS`,
`withOverflowWeek`): antes compartían celda con el mismo día de la semana 3, así que un plato
cambiado el martes 22 salía también el martes 29 y cambiar el 29 reescribía el 22. La IA sigue
generando 4 semanas y la compra sigue en 4 (`WEEK_COUNT`, días 29-31 en la última): la fila nueva
nace como copia de la semana 3, sin sus comidas fijadas a mano, que se sustituyen por el plato del
plan del mismo día en la fila anterior. `withOverflowWeek` la añade en `cleanPlan`, `completePlan`
y las lecturas del cliente (`withPlanRows` en `daily.ts`, web y móvil), y se guarda en la
siguiente escritura. Como la compra sigue en 4 semanas, a `projectTrips` se le pasa `WEEK_COUNT`,
nunca `plan.weeks.length`.

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
asigna compras ni escribe `qty`. `projectTrips` ([shopping/trips.ts](src/lib/shopping/trips.ts)) deriva
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

**Recálculo del plan (issue 05).** Antes un cambio en la despensa extra o en la mesa no tocaba el
plan ("no dispara regeneración"); el usuario lo revirtió el 2026-09-07. Ahora
`schedulePlanRecalc` ([src/lib/plan-recalc.ts](src/lib/plan-recalc.ts), copia en
`mobile/lib/plan-recalc.ts`) programa un recálculo **silencioso** tras un cambio de despensa
(`onSuccess` de `pantry`/`receipt` en la pantalla Plan). Un cambio de mesa (`addAdult` /
`dropMember` / `setMemberPortion` / `ChildSheet` / horario en Familia) ya **no** lo programa: desde
el 2026-09-28 quien planifica lo pide con "Rehacer plan con la familia"
(`rebuildPlanWithHousehold`, `scope: "full"` sin debounce) y la pantalla solo avisa de que la mesa
cambió. Motivo: es la operación de IA más cara de la app y con disparo automático + botón se
pagaba dos veces. Es por evento, nunca por tiempo. Un debounce de ~6 s
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
  Al acabar, `syncSharedMeals` copia las comidas compartidas a los miembros con la app (`synced`
  en la respuesta); sustituye al antiguo botón "Sincronizar el plan del mes".
  Guardas: solo el planificador (o quien va en solitario) ejecuta el recálculo — para un no
  planificador `reflowMonthlyPlan` devuelve `skipped: "not-planner"` sin gastar cuota. Bucket propio
  `plan-reflow` (12/h) en `RATE_LIMITS`.

Cambiar de cadencia (`recadenceMonthlyPlan`) en una lista **canónica** no llama a la IA ni toca
`shopping`: solo guarda la nueva cadencia y la UI re-proyecta. En una lista **antigua** sí rehace
el reparto de `trip` (`repartitionTrips`) y puede trocear un perecedero en varias filas;
`carryOwnedByName` (`shopping/trips.ts`) reaplica "en casa"/"comprado" por nombre para que las marcas
no se pierdan. Las listas antiguas se quedan como están: un mes no se regenera (ver "Un plan por
mes" en CLAUDE.md), así que pasan a canónicas en el plan del mes siguiente.

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
por reordenarlo. El registro guiado del chat (picoteo y deporte) y la herramienta
`registrar_deporte` acaban en este mismo asentamiento (`scheduleDaySettle`), nunca en
`ajustar_plan_mensual`: ver "El chat tampoco compensa por origen" en CLAUDE.md.

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

### Cómo se asienta el día

Cambiar un plato en Hoy, picotear y hacer deporte desvían el
día, y los tres se resuelven juntos: `day-settle.ts` tiene **un** debounce de 10 s compartido (el
"pendiente" se persiste y se fuerza al ocultar la app, misma forma que `plan-recalc.ts`) que acaba
en **una** llamada a `settleDay` ([src/lib/day-settle.functions.ts](src/lib/day-settle.functions.ts)).
El lote mandado sigue guardado (`inFlight`) hasta que `settleDay` responde bien: si la app se
cierra a mitad, al volver a Hoy se reenvía pasados 5 min (antes puede seguir en el servidor). Es
seguro porque el servidor no vuelve a contar un plato cuyo mismo desvío ya está compensado.
Esa función suma el día con `dayBalance` ([src/lib/day-balance.ts](src/lib/day-balance.ts), puro y
testeado), decide **una vez** con `compensationNeed` (tabla aprobada por objetivo), reserva los tres
libros de cuentas a la vez y llama **una vez** a `reflowMeals` con la nota del día entero
(`dayNote`). Recoloca comidas/cenas **propias** de mañana a hoy + 6 (`compensationWindow`,
`soloOnly`); la compra, hoy y el pasado no cambian. Como los platos del plan se escalan al objetivo de su comida,
cambiar un plato por otro más ligero ya no aligera nada por sí solo: `reflowMeals` guarda en cada
día recolocado lo que mueve cada plato (`PlanDay.kcalAdjust`, puente hasta el ticket 12, que lo
escribirá sin cambiar platos) y el escalado apunta a `objetivo + ajuste`. Lo que dice la tarjeta
(`absorbedKcal`) es exactamente lo que cambian esos días.

### El chat tampoco compensa por origen

El deporte y lo que se come encima del plan nunca van
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

### Procedencia y resultado

Los tres libros siguen donde estaban y son la PROCEDENCIA (`habits[].swapKcalDelta`,
`snacks.compensatedKcal`, `exercise.compensatedKcal`): de ahí sale el desglose que se enseña, y
mantienen la garantía de no compensar dos veces. El RESULTADO se guarda una sola vez, en
`daily_logs.adjustment` — el código tolera que la columna no exista todavía (42703), como
`reflowMeals` con `snacks`. `dayReversing` generaliza a todo el día las reglas que picoteo y
deporte tenían por separado para "esto deshace un ajuste ya aplicado".

### Cambio de plato en Hoy

Lo que aporta `use-meal-swap.ts` a ese lote es solo `resolveDishDeltas`: regenerar las macros del
día una vez y sacar el desvío por comida contra `plannedKcal` (congelada como `plannedIdea`, para
medir siempre contra el plan y no contra el cambio anterior). `setPlanMeal` escribe el plato al
instante y sin IA, y el estado es por comida, no global. Cada escritura de `habits` desde el cliente
pasa por `patchTodayHabits`, que escribe con CAS sobre `updated_at` (ver "Escrituras concurrentes" en CLAUDE.md).

### Tarjeta "Balance de hoy"

[src/components/day-balance-card.tsx](src/components/day-balance-card.tsx), debajo de "Registrar
deporte". Es una petición explícita del usuario: la persona tiene que VER que
lo que hace mueve el plan de los próximos días, porque eso genera confianza. Enseña el desvío del
día con el **desglose por origen** (comidas cambiadas · picoteo · deporte), que es lo que hace
legible la causalidad, y debajo los platos que se han movido, con el anterior tachado. El número es
inmediato (deterministas: tabla de composición y `estimateExerciseKcal`); los platos tardan lo que
tarde el modelo, y entre medias dice "Ajustando tus próximos días…". Cuando el plan **no** se mueve
también lo dice (`balanceNote`) — un "no he cambiado nada" explicado demuestra que el sistema estaba
mirando. Sustituye al bloque de ajuste de `snack-card` y `exercise-card` (ahora solo listas), a las
tres instancias de `AdjustmentInfoSheet` y al badge "i" por comida, que mentía: el servidor escribía
la misma lista de cambios en todas las comidas del lote.

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

**Las comidas compartidas se derivan de los horarios de cada persona** (desde `08fa7ae`,
05-09, migración `per_member_home_schedule`). Cada adulto (`household_members.home_schedule`) y
cada niño (`household_children.home_schedule`) dice cuándo come en casa
(`{desayuno,comida,cena: number[]}`, 0=lunes…6=domingo). Cada persona edita el suyo; el de un
niño o un hueco sin cuenta, solo el planificador (`saveHomeSchedule`, `scheduleTarget`). Una
comida de un día es "el mismo plato para toda la mesa" cuando el planificador está en casa y al
menos otra persona también; un bebé que aún no come de la mesa no cuenta
(`isEffectivelyShared`, `deriveSharedSlots` en
[household-shared.ts](src/lib/household-shared.ts)). En el servidor lo calcula
`householdContext` ([household.server.ts](src/lib/household.server.ts)) al leer; no se guarda.

`households.shared_slots` se conserva, pero ya **no la edita ninguna pantalla** (la antigua
`saveSharedSlots` y `/api/v1/household/shared-slots` se borraron el 28-09): es el horario de
partida de quien no ha puesto el suyo y, si nadie del hogar tiene horario, el valor tal cual.
El trigger `households_guard_shared_slots` (solo el planificador) sigue protegiéndola. El viejo
`household_members.shared_meals` y la intersección (`sharedDays`) ya no existen. Los snacks
nunca se comparten (D5).

**Una sola regla para servidor y pantallas.** `effectiveSharedSlots`
([effective-shared-slots.ts](src/lib/effective-shared-slots.ts), idéntico byte a byte en
`mobile/lib/` y vigilado por `scripts/check-shared-drift.sh`) rellena con la columna los
horarios que faltan, deriva si hay alguno y, si no, devuelve la columna. La usa
`householdContext` y, en el cliente, `householdSharedSlots(estadoDelHogar)` (`household.ts`, web y
móvil), que es lo que leen `fetchMonthlyPlan`, Hoy y Plan. Hasta el 28-09 el cliente leía la
columna a pelo (la RPC `household_plan_context` la devuelve): en 6 de 17 hogares ya no
coincidía con los horarios, y quien no planificaba veía el plato del planificador un día que
había marcado «no como en casa», mientras el servidor contaba con el suyo. `householdPlanInfo`
ya no expone la columna.

**Cada adulto con cuenta sigue teniendo su fila `monthly_plans` (D1).** No es todo suyo: los
slots compartidos de esa fila son un **espejo de solo lectura** del planificador, y los no
compartidos (sus desayunos si el finde no se comparte, sus snacks) los genera y edita él.
La composición es en vivo al leer — `composeDayForUser` / `composeMonthlyPlanForMember`
([plan/household.ts](src/lib/plan/household.ts)) mezclan las dos filas día a día — y hacia adelante
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
planificador. En `src/lib/plan/rows.server.ts`, `resolveShoppingRow` decide la fila objetivo
(`householdPlannerId`, una sola consulta) y `updateShoppingState` la lee y escribe sobre su
versión más reciente (CAS con `updated_at`, ticket 21): si el que llama no es el
planificador, con `supabaseAdmin` (RLS solo le deja LEER esa fila) y **solo** columnas de
estado, nunca `plan` ni `weekQty`. La pantalla Plan de
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
slots compartidos derivados de los horarios, niños con alergias, quién planifica) alimenta `generateMonthlyPlan`,
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

**`PlanDay.pinned` en una comida compartida no distingue quién la cambió.** `mirrorPinned` copia el
pin del planificador a todos los miembros por igual, así que un `isPinned(...)` a pelo en la UI
(p. ej. para ocultar "Ver receta" tras un cambio a mano) apagaba la receta a todo el hogar aunque
solo el planificador hubiera tocado el plato. Como `guardSharedSlotWrite` impide que un no
planificador escriba una comida compartida, "lo cambié yo" en ese caso equivale a "soy el
planificador": de ahí `dishChangeIsMine`/`isPinnedByViewer` (`plan/types.ts`), que sí lo
distinguen y son los que debe usar cualquier UI nueva que decida algo por "este plato se cambió
a mano".

## Receta canónica, caché y ración personal (`precision-nutricional`, fase 2)

Spec y tickets en `.scratch/precision-nutricional/` (05, 06, 14, 16, 17, 18, 21, 22, 23). Lo que
un cambio suele romper sin querer:

- **El modelo propone la composición; el código pone la cantidad.** `decomposeDishes`
  (`resolve-dish.server.ts`) pide con salida estructurada (`Output.object` + Zod) UNA ración base
  de AESAN en gramos **crudos** (arroz, pasta y legumbre en seco) y el `estado` de cada gramaje. El
  código casa cada ingrediente con la tabla (`foods.data.ts`, por 100 g; `matchFood`/
  `resolveIngredient` en `nutrition.ts`), lleva lo crudo a la fila en seco (`COOKED_TO_RAW`) o convierte con `cookedYield` según la
  `basis` de la fila (`gramsInRowBasis`); **sustituye** la grasa del modelo por `OIL_BY_METHOD`
  (`cooking.ts`; de dos métodos de calor cuenta el mayor, el aliño se suma, el untado solo sin
  calor); y pasa `validateRecipe` (techos por ingrediente, un huevo si acompaña, sin patata en una
  crema que no la nombra, fruta troceada a media pieza, UN reintento con pista si falta algo que
  el título nombra). `validateRecipe` está calibrado contra el golden set: su test exige que
  ninguna receta de referencia se toque. Si una regla nueva lo rompe, la regla está mal.
- **Calidad por kcal, umbral 0,90** (`resolutionQuality`, `MIN_RECIPE_QUALITY`). Lo que no casa y
  pesa ≥ 5 % de las kcal: primero USDA (ticket 22), luego el alimento más parecido (13). Por debajo
  del umbral el plato no se da por calculado (D13): "Calculando…" y se reintenta.
- **Todo plato se calcula, nada de promedios (13, D13; ya no existe `roughMealMacros`).** Cada
  `MealMacroEstimate` está `calculado` (sale de su receta, o la cifra la apuntó la persona:
  `manual`) o `calculando` (cifras a 0 que **no** suman, no miden ningún desvío y se enseñan como
  "Calculando…"; el semáforo del día queda gris). Una guía sin `status` cuenta como calculada. La
  cadena de `decomposeDishes` no se rinde a la primera: lote → reintento uno a uno →
  `DISH_FALLBACK_MODEL` (otra familia) → `calculando` con su motivo en el log
  (`decompose-chain.ts`, puro y testeado). Hoy reintenta lo que queda al abrirse, al volver a la
  app y cada 2 min (máx. 5 seguidos) con `macrosOnly` + `reuse` (solo se descompone lo que
  falta); el detalle de un día pasado recalcula al abrirse. Un ingrediente que no casa cae en la
  mediana de su `categoria` (la da el modelo) y, si aporta ≥ 5 % de las kcal, en el alimento más
  parecido de esa categoría que elige `DISAMBIGUATION_MODEL` de una lista cerrada (sin cifras);
  `GENERIC_FOOD` solo queda sin categoría. Un texto vago ("algo rápido") lo detecta `resolveDish`
  en `setPlanMeal` (`VAGUE_DISH_MESSAGE`): la hoja de "comí distinto" pide concretar u ofrece
  apuntar las kcal a mano (`MealHabit.manualKcal`). La **proteína** entra en la decisión de
  compensar: `perMealDeltas` devuelve kcal y proteína, `MealHabit.swapProteinDelta` lleva la misma
  contabilidad que `swapKcalDelta`, y `settleDay` pasa `balance.proteinPending` a
  `compensationNeed`.
- **Caché global `dish_recipes`** (`getRecipes` en `recipes.server.ts`, clave `dishKey`: palabras
  ordenadas y en singular, sin quitar nunca "sin" ni "fresco"). Solo escribe el servidor. Las
  macros NO se guardan: `macrosOfRecipe(receta, factor)` al leer. Una receta de un
  `PIPELINE_VERSION` antiguo sin `reviewed` se vuelve a descomponer. Sin la migración aplicada
  (PGRST205), todo funciona con una caché por proceso. `bun run recipes:review` lista las más
  usadas con calidad < 0,95 o flags.
- **Precalentamiento**: la pantalla Plan manda los platos del mes de hoy en adelante a
  `POST /api/v1/recipes/warm` en trozos de 8 (`recipe-warm.ts`, web y móvil) y enseña "Calculando tus
  platos 24/48". Recuerda en `localStorage`/`AsyncStorage` lo ya calculado; si la app se cierra a
  medias, lo retoma al volver a Plan.
- **Ración personal** (`portion.ts`, copia en `mobile/lib/`): factor `plan` = objetivo ÷ 2.000 para
  los platos del plan y `habitual` = mantenimiento ÷ 2.000 para "comí distinto", entre 0,6 y 1,7;
  sin datos, por sexo. En una comida compartida del hogar, la **media** de los adultos
  (`sharedMealPortions`, con la clave de servicio). **Privacidad:** esa media no se guarda junto a
  la comida (`MealMacroEstimate.portion` solo va en las propias): con el factor propio dejaría
  despejar el de los demás. `guide.portionFactor` guarda el factor del día para los días pasados.
- **Escalado al objetivo de la comida (08 adelantado)**: una ración de AESAN es una unidad (se
  recomiendan varias al día), así que sin escalar el día del plan se quedaba en ~60 % del
  objetivo. `scale.ts` (puro, solo servidor). Grupos
  por los datos del alimento: V (verdura, fruta, condimentos < 60 kcal) fijo, P (proteína ≥ 35 %
  de las kcal) y E (el resto). Se recorre `fP` en pasos de 0,01 y `fE` se despeja de las kcal:
  kcal primero (±1 %), luego la proteína de la comida, luego el reparto menos deformado. Límites
  sobre la ración personal: `fP` 0,75-1,6, `fE` 0,6-2,0, `fP/fE` 0,5-2 (el 08 proponía `fE` ≤ 1,4,
  pero la ración de cereal de AESAN es la mitad de un plato y con ese techo ningún día llegaba). Lo
  que no cabe queda como residuo. Una pieza (`unidad`) no se escala por grupos: en el plan se sirve
  en piezas enteras, las más cercanas al objetivo (mínimo una). Se calcula al leer, no se
  guarda: `plannedMacros` sirve los platos del plan y `plannedServingsFor` (`planned-serving.server.ts`) junta la ración personal, `perSlot`,
  el `kcalAdjust` del día y la ración y el objetivo medios del hogar (`sharedMealPortions`); la
  guía, `compensateFutureDishChange` y `eval:plan-lite` lo usan.
- **Cierre del día (`alignSoloMeals` del 08)**: `day-close.ts` (`closeDay`/`serveDay`, puro).
  Lo que una comida no alcanza por sus límites (una merienda de una fruta, un desayuno de solo
  pan) se reparte entre las demás comidas propias del día que responden al escalado, en
  proporción a su objetivo, hasta 3 pasadas; una que toca su límite se queda en lo que sirve y lo
  que ya no cabe queda como `residual` (lo que el `planFit` del 10 tiene que corregir cambiando
  platos). Una compartida no absorbe pero cuenta con el objetivo PROPIO de esa comida
  (`ResolvedServing.goal`), no con el medio del hogar con el que se sirve: si el plato común da
  de más, bajan las propias. **Se cierra siempre sobre los platos planeados** (`plannedIdea`, que
  `guideMeals` manda como `planned` si hoy se cambió): la ración de la cena no puede cambiar por
  lo que se comió a mediodía, porque compensar un cambio de hoy es de `settleDay` y solo desde
  mañana. Por eso toda llamada a la guía pasa las comidas por `guideMeals` (también el cambio de
  plato del chat y el recálculo de un día pasado, que manda el día entero con su fecha).
  `compensateFutureDishChange` mide el desvío del día entero cerrado, no el del plato suelto.
- **"Comí distinto" (17)**: la guía recibe cada comida cambiada con `eaten` y su `size`
  (`guideMeals`). Cantidad = la del texto ("media pizza") → una pieza entera si es `unidad` → plato
  × `habitual`, con los chips pequeño · normal · grande (×0,75 · ×1 · ×1,3) que aprenden el tamaño
  tras 5 iguales (`learnedPortionSize`, `MealHabit.portionSize`). Un plato (no una pieza) se escala
  como los del plan, pero con la ración habitual y al objetivo de esa comida a mantenimiento
  (`eatenMacros`, `resolveEatenServing`), y encima texto o chip. Las dos cifras a la misma escala:
  para quien mantiene, comerse el plato del plan con el chip "normal" da desvío 0.
- **Deporte (16)**: neto y con el peso (`estimateExerciseKcal` → `exerciseNetKcal`). `logExercise`
  reparte cada sesión con `splitRoutineSession`: si esta semana ISO quedan sesiones de la rutina de
  `profiles.training`, su parte normal ya va en el objetivo y solo `kcal` (lo que desvía el día)
  lleva el exceso. Un perfil sin `daily_activity` no tiene rutina separada (todo extra, como antes).
  La hoja guiada del chat usa la misma cifra y compensa igual que Hoy, con `settleDay` (ver "El
  chat tampoco compensa por origen" en CLAUDE.md).
- **Reajuste medido (18, puente hasta el 12)**: `reflowMeals({ measure: true })` mide con las
  recetas cuánto compensan de verdad los platos cambiados (`absorbedKcal`); por debajo del 50 %
  insiste UNA vez con los números. `DayAdjustment.absorbedKcal` y la tarjeta lo dicen
  (`absorbedNote`). Se registra `ratio` en el log para compararlo con el 12. Con el escalado, lo
  que mueve cada plato se guarda en el día (`PlanDay.kcalAdjust`, `addKcalAdjust`) y el objetivo
  de esa comida lo resta; también sin `measure` cuando hay `kcalDelta` (coach, plato futuro). Solo
  cuenta en comidas propias. El 12 escribirá el mismo campo sin cambiar platos.
- **Plan con objetivo (23)**: el prompt del plan lleva las kcal y la proteína por comida, la media
  del hogar para las compartidas y la estructura "plato · acompañamiento · postre"
  (`planTargetsPrompt`). Los planes nuevos llevan `targetsVersion`; Hoy explica que uno anterior se
  queda corto. `bun run eval:plan-lite` lo mide.
- **USDA (22, `usda.server.ts`)**: `USDA_FDC_API_KEY` en `.env` y en Vercel (clave gratuita de api.data.gov; sin ella
  no se busca). Lo encontrado va a `foods_extra` y se registra como una fila más
  (`registerExtraFoods`, `ensureExtraFoods`). `bun run foods:review` para pasarlas a la tabla.
- **Migraciones manuales**: `20260925140000_dish_recipes.sql` y `20260925150000_foods_extra.sql`
  (SQL Editor). Hasta aplicarlas no hay caché global ni filas de USDA persistentes.
- **`foods.data.ts` no entra en el bundle del navegador.** El cliente solo importa módulos de
  `src/lib/nutrition/` que no la cargan (`energy`, `portion`; `nutrition.ts` y `recipe.ts` sí la
  cargan), y un lint prohíbe importarla fuera de su carpeta, de un `*.server.ts` o de un test.
- **Medida**: `bun run eval:recipes` (exactitud contra el golden set) y `bun run eval:plan-lite`
  (el plan contra el objetivo). Gastan llamadas y no van en CI.

## Push notifications

Web Push real (VAPID) vía [`@pushforge/builder`](https://github.com/draphy/pushforge) — usa solo
Web Crypto API (el `web-push` de npm depende de `crypto.createECDH()`, que no está en todos los
runtimes serverless; se eligió cuando la app corría en Cloudflare Workers y hoy corre en Vercel).
Requiere en `.env` (par generado con `bun x pushforge vapid`): `VAPID_PRIVATE_KEY` (servidor, el
JWK privado), `VITE_VAPID_PUBLIC_KEY` (cliente, la clave pública), `VAPID_CONTACT` (opcional,
`mailto:` del remitente) y `CRON_SECRET` (protege `/api/cron/dispatch`, ver abajo).

El disparo periódico no usa un cron de la plataforma: un workflow de GitHub Actions
([.github/workflows/push-dispatch.yml](.github/workflows/push-dispatch.yml)) llama cada 15 min a
`POST /api/cron/dispatch` (protegido por `x-cron-secret`), que reutiliza
[src/lib/push-dispatch.server.ts](src/lib/push-dispatch.server.ts) para mirar qué perfiles caen en
la ventana de su `morning_time`/`evening_time` — cada uno evaluado contra su propia
`profiles.timezone` (detectada del dispositivo; ver [src/lib/zoned-date.ts](src/lib/zoned-date.ts)) —
y enviar el push.
Necesita los secrets de repo `APP_URL` y `CRON_SECRET` en GitHub una vez desplegada la app.
`CRON_SECRET` se compara en tiempo constante (`cronSecretMatches`) y con menos de 32 caracteres no
vale ni acertándolo (`cron_secret_weak` en el log): se rota con `openssl rand -hex 32`.

El servidor hace `fetch` a cada endpoint guardado, así que solo se aceptan servicios de push de
verdad (`isAllowedPushEndpoint`, [src/lib/push-endpoint.ts](src/lib/push-endpoint.ts): FCM,
Apple, Mozilla y Windows). Se comprueba al suscribirse y otra vez al enviar (uno que no pasa se
trata como `gone` y se borra), y la BD no deja insertar suscripciones con la sesión de la persona:
un host nuevo se añade ahí, no en la ruta. Cada envío corta a los 10 s. Un fallo no debe tumbar el
lote: una `timezone` que no existe usa el reloj de Madrid, y si falla una consulta (planes,
suscripciones, el día, el hogar) no se envía ni se marca lo que dependía de ella, para que el
siguiente disparo lo reintente (`push_query_failed`).

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

El enforcement es `assertCleanFood` (`assert-clean-food.ts`, solo web) en los `.validator()` — `setPlanMeal`, `setChildMeal`, `setPantryExtra`, el
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

### Lo que el coach escribe en el perfil se valida, y lo sensible se confirma

`actualizar_perfil` pasa por `profilePatchFromTool` ([src/lib/profile-fields.ts](src/lib/profile-fields.ts),
copia idéntica en `mobile/lib/`): cada campo con su formato y sus límites, y un chip **solo** con
una de sus opciones. No es cosmética: el prompt y el cálculo de energía comparan con el valor exacto
(«embarazada», «activa»), y un texto libre como «Primer trimestre» dejaba el perfil diciendo
embarazo sin que se aplicara ninguna de sus reglas. Lo rechazado vuelve al modelo con los valores
válidos, para que reintente o pregunte en vez de decir que lo ha guardado.

Los campos de `SENSITIVE_PROFILE_FIELDS` (embarazo, TCA, medicación, condiciones médicas,
alergias y su gravedad, tipo de alimentación, peso objetivo, ver cifras) no se guardan sin que la
persona lo confirme: `useSensitiveProfileConfirm` en la web, `Alert` en el móvil, mismo texto
(`sensitiveConfirmCopy`). Un campo nuevo que cambie la seguridad o el plan de forma importante va
a esa lista.

### Nombres: aviso, no frontera

`assertCleanName` (en `src/lib/household.ts` y su copia móvil, más `saveProfile` en `daily.ts`)
cubre el nombre de un miembro de la mesa, el de un peque y `profiles.display_name` — los ve todo
el hogar. Pero esas escrituras van **del navegador directo a Supabase**, sin server function de
por medio, así que ahí no hay ningún validador donde enganchar: el guard avisa y se puede
esquivar con una llamada REST. Cerrarlo de verdad pide un trigger en Postgres o mover esas
escrituras a server functions (ticket `01-trigger-nombres.md`). El deporte no necesita nada:
`EXERCISE_ACTIVITIES` es una lista cerrada.

## Lo guardado en el dispositivo es de una persona

El borrador del onboarding (con datos de salud), los pendientes de `day-settle` y `plan-recalc`, el
aviso del plan y `recipe-warm` viven en `localStorage`/`AsyncStorage` con claves globales. Para
que en un dispositivo compartido nadie herede lo de otra persona, `STORAGE_OWNER_KEY` apunta de
quién son, y el listener de sesión de cada app (`__root.tsx`; `AuthCacheSync` en
`mobile/app/_layout.tsx`) aplica `localDataAction` (`user-storage.ts`, puro e idéntico en web y
móvil): al salir o al entrar otra cuenta se borran; sin dueño apuntado, se los queda quien tiene
la sesión. El borrado vive en `local-user-data.ts` de cada app. **Una clave nueva de una persona se
añade a `USER_KEY_PREFIXES`**, o sobrevivirá al cierre de sesión; las del dispositivo (idioma,
tema) no van ahí.
