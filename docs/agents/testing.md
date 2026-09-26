# Tests (web)

Suite de lógica pura con el runner de Bun. Cubre las funciones donde un bug pasa
desapercibido: cálculo del plan y de la compra, fechas, parsers defensivos de la salida de
la IA. No hay tests de componentes ni end-to-end (todavía).

## Comandos

```sh
bun test                        # toda la suite
bun test src/lib/plan-shared    # un archivo
bun test --watch                # en watch
bun run typecheck               # tsc del código de app
bun run typecheck:test          # tsc con los tests dentro (ver abajo)
```

El CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) corre `bun install`,
`lint`, `typecheck`, `typecheck:test` y `test` en cada push y PR.

## Dónde viven

`src/lib/<módulo>.test.ts`, junto al módulo que prueban. Import relativo (`./plan-shared`),
no `@/`. `bun test` descubre cualquier `*.test.ts` **dentro de `src/`** (`[test] root` en
[bunfig.toml](../../bunfig.toml)): un test fuera de `src/` no se ejecuta. Sin ese `root`, cada
ejecución recorría el repo entero, `mobile/ios` incluido (>1 GB), y eso era ~70 % del tiempo.

Qué hay cubierto hoy:

| Archivo                             | Foco                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plan-shared.test.ts`               | `tripDayRange` (regresión "días 32-31"), `compensationWindow` (ventana de mañana a hoy + 6, fin de mes, días con comida propia), `composeDayForUser` sin reordenar `kids`, `mergeFuturePlan` (un plato a mano sobrevive a una recolocación), `withPlanMeal` y `pinned` (ni `applyPlanChanges` ni `mergeFuturePlan` pisan una comida fijada; espejo del hogar), cobertura del mes, totales de dinero, `repartitionTrips`/`groupByTrip`, `parseJsonLoose`, `cleanShopping`/`cleanPlan` |
| `week-nav.test.ts`                  | semanas de la tira de Hoy: lunes de la semana, cambio de hora de octubre, semanas entre dos meses, límites (alta, mes siguiente desbloqueado), etiqueta, `isPastDayEditable` y su margen con la ventana de relleno                                                                                                                                                                                                                                                                   |
| `zoned-date.test.ts`                | `zonedTodayISO`/`zonedMinutesNow` por zona horaria (Madrid por defecto, Nueva York, México, Tokio, cruces de medianoche)                                                                                                                                                                                                                                                                                                                                                             |
| `age.test.ts`                       | años cumplidos en el límite del cumpleaños                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `safe-next.test.ts`                 | `safeInternalPath` rechaza redirects a otro origen                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `macros.test.ts`                    | `sumDoneMacros` (suma por status, matching moment↔label, platos fantasma, deshacer), `macroTargets` (fallback genérico, clamp), `ZERO_MACROS`, `addMacros`                                                                                                                                                                                                                                                                                                                           |
| `snacks.test.ts`                    | picoteo (`picoteo-hoy`): libro de cuentas `pendingSnackKcal` (acumula, no compensa dos veces, borrado compensado → negativo), `cleanDaySnacks` (lectura defensiva), `scaleSnackMacros`, `mergeAdjustment` (conserva el plato de antes del primer reajuste), `snackOutcomeNote`                                                                                                                                                                                                       |
| `day-balance.test.ts`               | balance del día (`balance-del-dia`): `dayBalance` suma los tres orígenes (los dos fallos que arregla: dos desvíos pequeños de origen distinto que sí cruzan el umbral, y picoteo contra deporte que se anulan), `net` vs `pending` con algo ya compensado, un plato deshecho que decide pero no se enseña, `dayReversing` generalizado, `mergeDayAdjustment` entre pasadas, `cleanDayAdjustment`, `dayNote` y `balanceNote`                                                          |
| `day-log-ack.test.ts`               | acuses de lo que el chat apunta en el día (registro guiado y `registrar_deporte`): `exerciseAckMessage`/`snackAckMessage` (cifra solo con "ver cifras" y si suma algo, nunca piden ajustar), prefijos que reconoce el prompt, `exerciseToolResult`, `loggedAckKind`                                                                                                                                                                                                                  |
| `nutrition/compensation.test.ts`    | `compensationNeed`: la tabla de umbrales aprobada en cada límite (199/200, −399/−400), sin objetivo → mantener, proteína −20 g, embarazo/lactancia nunca recorta                                                                                                                                                                                                                                                                                                                     |
| `food-categories.test.ts`           | `classifyDish` (precedencia multi-palabra, límites de palabra, palabras clave con ñ), `ingredientIcon`/`dishAsset` con ñ, paleta de acentos                                                                                                                                                                                                                                                                                                                                          |
| `rate-limit-error.test.ts`          | `retryAfterText` (límites minuto/hora/día, singular/plural, sin encadenar dos redondeos) y el mensaje de `RateLimitError` (cuota horaria y tope de gasto)                                                                                                                                                                                                                                                                                                                            |
| `ai-spend.test.ts`                  | `callCostUsd` (coste reportado por OpenRouter vs. estimación por tokens), `decideSpendCap` (tope con `>=`, la llamada que cruza pasa, mes antes que día, espera hasta medianoche/día 1 UTC, cambio de año, `numeric` como texto), `abortedCallCostUsd` (una llamada cortada por timeout se apunta al tope con una salida supuesta, nunca gratis)                                                                                                                                     |
| `auth-errors.test.ts`               | `authErrorKey`/`authErrorText` (traducción por código de Supabase, respaldo por texto, mensajes propios tal cual) y que un error ajeno nunca se enseña en crudo                                                                                                                                                                                                                                                                                                                      |
| `content-guard.test.ts`             | `blockedTermIn`: comida real que se parece a algo bloqueado (`cacahuete`, `cacao`, `penne`, `queso de tetilla`, `rabo de toro`, `cagarrias`, `puttanesca`) frente a la broma (`caca`, `c4c4`, `penes`), comparación por token entero y nunca por subcadena, plurales y leet                                                                                                                                                                                                          |
| `coach-scope.test.ts`               | `offTopicReason`: corta la anulación de instrucciones y la petición de código, y **no** corta frases legítimas de comida ("olvídate de la cena", "¿cuál es mi código de invitación?"); `offTopicMessage` sigue el idioma del perfil                                                                                                                                                                                                                                                  |
| `nutrition/decompose-chain.test.ts` | cadena de `decomposeDishes` (ticket 13, D13): un plato que falla con el primer modelo sale con el segundo, reintento uno a uno solo de lo que falta, si fallan los dos queda con su motivo, el tope mensual corta la cadena, vago y "no es comida" no se reintentan, `parseDecomposition`, `matchAnswer` (etiquetas con el número de la lista, plato que empieza por número, por posición solo con un plato, nunca adivina entre varios)                                             |
| `nutrition/energy.test.ts`          | objetivo energético (ticket 07): los 7 ejemplos del ticket (el 1 con el tope de proteína del 30 %), normalización de `activity_level` con los valores reales de producción, reparto por comida, rutina (`parseTraining`, gasto neto), `caloriesText` sin cifras                                                                                                                                                                                                                      |
| `plan-eval/accuracy.test.ts`        | métricas de exactitud del eval (`precision-nutricional`, ticket 02): error de kcal con signo, densidad independiente del tamaño de ración, suelo de macros para valores diminutos, ingredientes principales por kcal **o** masa, identidad agrupada (dos filas del mismo ingrediente no son un invento), media de pasadas con unión de omisiones, CV entre pasadas, percentil, `ingredientDiff`                                                                                      |
| `plan-eval/golden.test.ts`          | golden set: la conversión de la referencia a la base de la tabla coincide con la del pipeline (`wasRaw`), seco → fila cocida conservando kcal, validación (pesar en crudo una fila solo cocida, fuentes), las 75 recetas son válidas y con el reparto por momento del día, `tableErrorOf` (fila equivocada, fila que falta → genérico)                                                                                                                                               |

## Tests de servidor: el doble de Supabase

Lo que lee o escribe en la base de datos se prueba con un doble en memoria,
[src/test/fake-supabase.ts](../../src/test/fake-supabase.ts) (su propio test,
`fake-supabase.test.ts`, fija cómo se comporta cada operación frente a PostgREST):

```ts
const fake = createFakeSupabase({ household_members: [...] }, { failOn, rpc });
await householdContext(fake.client, "u1"); // client: el AnyClient que esperan las funciones
fake.calls;  // cada operación en orden: tabla, op, columnas, filtros, payload
fake.tables; // el estado tras las escrituras
fake.db;     // el mismo objeto con su tipo real, para consultar o sembrar desde el test
```

Proyecta las columnas pedidas (un campo que no se pidió sale `undefined`, como en producción),
devuelve el `PGRST116` real en `single`/`maybeSingle`, avanza `updated_at` en cada `update`
(estrictamente creciente, para probar CAS) y `failOn` hace fallar la operación que se quiera.
No es Postgres: ni RLS ni joins embebidos. Una policy se prueba contra la BD.

**`supabaseAdmin` nunca es el real en un test.** En local `bun test` carga el `.env`, así que un
test que lo tocara hablaría con producción con la clave de servicio. El preload
([src/test/setup.ts](../../src/test/setup.ts), en `bunfig.toml`) sustituye
`@/integrations/supabase/client.server` en toda la suite por un Proxy que **lanza** si nadie lo
ha apuntado a un doble; un test lo apunta con `setFakeAdmin(fake.client)`
([src/test/admin.ts](../../src/test/admin.ts)) y un `afterEach` lo suelta. Así el código de
servidor no necesita parámetros para inyectar el cliente.

## Regla al tocar esta lógica

Si cambias una función en `plan-shared.ts`, `plan.functions.ts`, una de fechas o un parser:
**añade o actualiza su test en el mismo cambio.** Es la defensa contra el bucle "arreglo un
bug y salen dos". El test debe codificar la intención documentada (el comentario de la
función), no solo el valor que devuelve hoy.

## Evals (gastan llamadas, no van en CI)

Dos bancos en `src/lib/plan-eval/`, que se corren a mano (`eval:dishes`, el de cobertura, se
retiró con el ticket 05: daba "100 % de calidad" a platos con un 40 % de error):

- `bun run eval:recipes` — **exactitud** (`precision-nutricional`, ticket 02): el error de las
  cifras frente a 75 recetas de referencia (`golden-recipes.data.ts`, ración base = mitad del
  rango de AESAN) y el de la tabla frente a 17 referencias externas (`golden-external.data.ts`,
  USDA y etiquetas de Open Food Facts; esta parte no gasta llamadas). Escribe `eval-report.md`
  y compara con `baseline-recipes.json`; `--save-baseline` la fija, `--passes`, `--limit`,
  `--dish`, `--model` y `--reviewed` acotan la pasada. Una pasada en la que el modelo no
  devuelve nada se cuenta aparte, no como error de exactitud.
- `bun run eval:plan-lite` — **el plan contra el objetivo** (ticket 23): genera el plan de varias
  tipologías con el generador de producción y suma cada día con la ración personal frente a
  `energyTargets`. Objetivo provisional: ≥ 70 % de los días a ±15 % y ninguna comida principal de
  un solo componente. `--only <tipología>` y `--days <n>` lo acotan.

`validateRecipe` tiene además un test que NO gasta llamadas y hace de red: ninguna receta del
golden set puede recortarse ni pedir reintento. Si una regla nueva lo rompe, la regla está mal.

## Nota: tipos de `bun:test` y `tsc`

`tsconfig.json` excluye los `*.test.ts`; los comprueba `tsconfig.test.json`
(`bun run typecheck:test`, también en el CI), que extiende el principal y añade los tests
más **un solo archivo** de tipos: `node_modules/bun-types/test.d.ts`, el
`declare module "bun:test"`. No uses `"types": ["bun-types"]` ni instales `@types/bun`:
eso mete en el scope global todo `bun-types`, y su `fetch` con `preconnect` rompe el `fetch`
de navegador que la app pasa a Supabase (4 errores en `client.ts`, `client.server.ts`,
`auth-middleware.ts` y `api-auth.server.ts`). `bun-types` llega como dependencia transitiva;
si una actualización lo quitara, `typecheck:test` fallaría con "Cannot find module
'bun:test'".

## Cuándo sube el listón

Cuando haga falta probar un componente React o un flujo con render, el siguiente paso es
**Vitest**: reutiliza [vite.config.ts](../../vite.config.ts) tal cual (alias `@/`, plugins),
así que no hay doble configuración. No se ha montado porque hasta ahora todo lo que valía la
pena probar es lógica pura.
