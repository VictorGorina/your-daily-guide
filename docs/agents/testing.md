# Tests (web)

Suite de lógica pura con el runner de Bun. Cubre las funciones donde un bug pasa
desapercibido: cálculo del plan y de la compra, fechas, parsers defensivos de la salida de
la IA. No hay tests de componentes ni end-to-end (todavía).

## Comandos

```sh
bun test                        # toda la suite
bun test src/lib/plan-shared    # un archivo
bun test --watch                # en watch
bun run typecheck               # tsc del código de app (no de los tests, ver abajo)
```

El CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) corre `bun install`,
`lint`, `typecheck` y `test` en cada push y PR.

## Dónde viven

`src/lib/<módulo>.test.ts`, junto al módulo que prueban. Import relativo (`./plan-shared`),
no `@/`. `bun test` descubre cualquier `*.test.ts` sin configuración.

Qué hay cubierto hoy:

| Archivo                   | Foco                                                                                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plan-shared.test.ts`     | `tripDayRange` (regresión "días 32-31"), `mergeFuturePlan` (un plato a mano sobrevive a una recolocación), cobertura del mes, totales de dinero, `repartitionTrips`/`groupByTrip`, `parseJsonLoose`, `cleanShopping`/`cleanPlan` |
| `zoned-date.test.ts`      | `zonedTodayISO`/`zonedMinutesNow` por zona horaria (Madrid por defecto, Nueva York, México, Tokio, cruces de medianoche)                                                                                                         |
| `age.test.ts`             | años cumplidos en el límite del cumpleaños                                                                                                                                                                                       |
| `safe-next.test.ts`       | `safeInternalPath` rechaza redirects a otro origen                                                                                                                                                                               |
| `macros.test.ts`          | `sumDoneMacros` (suma por status, matching moment↔label, platos fantasma, deshacer), `macroTargets` (fallback genérico, clamp), `ZERO_MACROS`                                                                                    |
| `food-categories.test.ts` | `classifyDish` (precedencia multi-palabra, límites de palabra), paleta de acentos                                                                                                                                                |

## Regla al tocar esta lógica

Si cambias una función en `plan-shared.ts`, `plan.functions.ts`, una de fechas o un parser:
**añade o actualiza su test en el mismo cambio.** Es la defensa contra el bucle "arreglo un
bug y salen dos". El test debe codificar la intención documentada (el comentario de la
función), no solo el valor que devuelve hoy.

## Nota: tipos de `bun:test` y `tsc`

Los `*.test.ts` están **excluidos** de `tsconfig.json` a propósito. Instalar `@types/bun`
para tipar `bun:test` arrastra `bun-types/globals.d.ts` al scope global (vía referencias
`import("bun")` de la pila de Nitro), y su `fetch` con `preconnect` rompe el `fetch` de
navegador que la app pasa a Supabase. `bun test` trae sus propios tipos en runtime, así que
la suite corre sin el paquete; lo que se pierde es el autocompletado de `bun:test` en el
editor. Si lo necesitas, instala `@types/bun` solo en tu entorno y asume el ruido en
`bunx tsc` — no lo añadas a `package.json`.

## Cuándo sube el listón

Cuando haga falta probar un componente React o un flujo con render, el siguiente paso es
**Vitest**: reutiliza [vite.config.ts](../../vite.config.ts) tal cual (alias `@/`, plugins),
así que no hay doble configuración. No se ha montado porque hasta ahora todo lo que valía la
pena probar es lógica pura.
