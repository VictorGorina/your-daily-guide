# 05 — Recálculo automático del plan al cambiar despensa o miembros

Status: HECHO (2026-09-07), gates verdes + verificado en navegador; pendiente simulador iOS
Incidencia del usuario: ⓻
Blocked by: 03 (resuelto)

## Objetivo

Que el plan se recalcule **solo**, sin preguntar, cuando cambia algo que lo invalida: se añade
un ingrediente que la compra no incluye, o entra o sale alguien de la mesa. Platos y
cantidades, los dos.

## Decisión del usuario (D1, 2026-09-07) — leer antes de tocar nada

Se le ofrecieron tres opciones y se le **recomendó la intermedia**: reescalar cantidades de
forma determinista (sin IA) y dejar tras un banner "Actualizar" solo lo que necesita IA,
advirtiéndole explícitamente de que la opción automática gasta una llamada de pago y con cuota
en cada cambio. **Eligió automático y silencioso.**

No re-proponer un paso de confirmación como medida de ahorro. Si aparece un problema nuevo,
plantearlo como problema, no como excusa para volver al banner.

## Contexto

Hoy no pasa nada: `setPantryExtra` (`src/lib/plan.functions.ts:748`) solo escribe
`pantry_extras`; `addAdultSlot` / `addChild` / `removeMember` (`src/lib/household.ts`) no tocan
el plan; `syncHouseholdPlan` solo espeja las comidas del planificador.

**Esto era deliberado**: CLAUDE.md dice que la despensa extra se trata como disponible al
recolocar "sin disparar regeneración". Ese párrafo hay que actualizarlo en este ticket.

## Tareas

1. **Disparar `adjustMonthlyPlan`** desde `setPantryExtra`, `addAdultSlot`, `addChild`,
   `updateChild` (cambio de `feeding_stage`) y `removeMember`.
2. **Agrupar disparos.** Si se escriben cuatro ingredientes seguidos no deben salir cuatro
   llamadas a la IA, sino una. Sin esto la cuota de `RATE_LIMITS`
   (`src/lib/rate-limit.server.ts`) corta a mitad de la lista y la función queda peor que
   antes. Esto **no** es un "¿seguro?" encubierto: no le pregunta nada a la persona.
3. **Respetar lo hecho a mano**: `mergeFuturePlan` ya garantiza que un cambio manual no se
   pisa, y hoy y los días pasados no se tocan nunca. Confirmar que se sigue cumpliendo tras el
   cambio y dejarlo cubierto por un test.
4. **Cantidades por raciones**: al entrar o salir alguien, las cantidades deben reflejar los
   comensales nuevos (`servingsPerSlot` / `childRation` en `src/lib/household-shared.ts`, y
   ojo con `eatsTableFood`: los bebés de `pecho` y `triturados` no cuentan para el plato
   compartido).
5. **Solo el planificador regenera**: un no planificador que añada un ingrediente no debe
   disparar una regeneración del plan de otra persona. Repasar contra `guardSharedSlotWrite` y
   `resolveShoppingRow`.
6. **Copy**: hoy la subpestaña Ingredientes dice "lo tendré en cuenta al recolocar los próximos
   días. No se añade a la compra." Ya no describe lo que hace; reescribirlo en las dos apps.
7. **Actualizar CLAUDE.md** (sección de despensa extra) y `AGENTS.md` si aplica.

## Verificación

- Perfil demo con plan generado: añadir un ingrediente a la despensa → el plan de los días
  futuros cambia solo, hoy no se toca, y un plato que se hubiera fijado a mano sigue en pie.
- Añadir un adulto → las cantidades de la compra suben; quitarlo → bajan.
- Añadir cuatro ingredientes seguidos → **una sola** llamada a la IA (mirar los logs del
  servidor).
- `bun run lint` / `typecheck` / `test` verdes.

## Hecho cuando

Cambiar la despensa o la mesa actualiza el plan sin que nadie pulse nada, sin agotar la cuota y
sin pisar los cambios hechos a mano.

## Answer (2026-09-07)

Decisiones del usuario en esta sesión, que ajustan las tareas de arriba:

- **Agrupado = mecanismo A**: debounce en cliente (~6 s) + red de seguridad al abrir Plan. Sin
  migración, sin cron, sin marca en BD.
- **Cambio de mesa → cantidades por IA** (no reescalado determinista): la lista de la compra se
  regenera con la IA para la gente nueva, preservando lo ya fijado/comprado. Esto sustituye la
  tarea 4 ("reescalar con `servingsPerSlot`").
- **Purés de bebé**: los cubre la propia regeneración `scope: "full"` (el prompt de
  `generatePlanBody` ya emite `days[].kids` para triturados), no hace falta un `fillChildMeals`
  aparte.

### Qué se hizo

**Servidor** (`src/lib/plan.functions.ts`, `plan-shared.ts`, `rate-limit.server.ts`):

- `generatePlanBody(...)` — extracción pura del cuerpo de `generateMonthlyPlan` (prompt + IA +
  `enforceBudget` + cinturones), sin leer/escribir BD ni cuota. `coverage` es parámetro para que
  un reflow a media de mes no recorte el rango original.
- `reflowMeals(...)` — extracción del cuerpo de `adjustMonthlyPlan` (recolocación de días futuros,
  `mergeFuturePlan`, `syncSharedMeals`). `adjustMonthlyPlan` ahora lo llama.
- `reflowMonthlyPlan({ month, today, scope })` server fn + ruta espejo `api/v1/plan/reflow.ts`.
  Guardas: mes pasado → `skipped: "past"`; no planificador (`householdPlannerId`) →
  `skipped: "not-planner"`; sin plan → `skipped: "no-plan"`. Bucket `plan-reflow` (12/h).
  - `scope: "meals"` → `reflowMeals` con nota sintética. La compra no se toca.
  - `scope: "full"` → `generatePlanBody` con el hogar nuevo → `mergeFuturePlan` +
    `mergeFutureKids` (nuevo helper: adopta los purés del plan nuevo en días futuros salvo donde
    hay un `setChildMeal` a mano; descarta los de un niño que ya no está) →
    `carryOwnedCanonical` (nuevo helper: traspasa `ownedTrips`/`owned` por nombre a las
    cantidades nuevas) → `confirmed_at: null`.

**Cliente** (`src/lib/plan-recalc.ts` + copia `mobile/lib/plan-recalc.ts`):

- `schedulePlanRecalc(month, today, scope)` — debounce ~6 s, `"full"` gana sobre `"meals"`,
  persiste `{scope,today}` en `localStorage`/`AsyncStorage`.
- `flushPlanRecalc(month?)` — dispara ya; la usa la red de seguridad y el
  `visibilitychange`/`AppState`.
- `onPlanRecalcDone(cb)` — la pantalla Plan refresca `["plan", month]` /
  `["planner-shopping", month]` al terminar. Sin toast de éxito (el `intro` del plan explica el
  cambio); disparo silencioso.

**Wiring** (web + móvil): `plan.tsx` (`pantry`/`receipt` `onSuccess` → `"meals"`, solo si
`!isSoloPlanner`), `hogar.tsx` (`addAdult`/`dropMember`/`setMemberPortion` → `"full"`, solo si
`isPlanner`), `child-sheet.tsx` (nuevo prop `onChanged` → `recalcRoster`). Red de seguridad +
`wirePlanRecalcFlush` en `plan.tsx`.

**Copy** (tarea 6): tarjeta "Ya lo tengo en casa" en `plan.tsx` ×2 → "…recoloco los próximos
días para aprovecharlo. Tu lista de la compra no cambia."

**Docs** (tarea 7): CLAUDE.md + AGENTS.md (sección nueva "Recálculo automático del plan") +
`docs/agents/code-review.md` (checklist).

**Tests**: `plan-shared.test.ts` +8 — `carryOwnedCanonical` (traspaso por nombre, singular/plural,
cantidades intactas) y `mergeFutureKids` (adopta puré nuevo, respeta plato a mano, descarta niño
ausente, no toca hoy/pasado). 241 tests verdes. `bun run lint`/`typecheck`/`build` limpios;
`mobile` `tsc` limpio.

### Verificado en el navegador (perfil demo "Nacho", solo)

- `scope: "meals"` → recoloca platos futuros, `shopping` byte a byte idéntico. El `intro` del
  plan pasa a explicar el cambio ("…para aprovechar los garbanzos que tienes").
- `scope: "full"` → regenera plan y `shopping` (25→31 artículos), **hoy no se toca** (comida =
  "Lentejas estofadas" antes y después), días futuros sí cambian, `carryOwnedCanonical` conserva
  la marca "en casa"/"comprado" (incl. cuando la IA reescribe "Patatas" → "Patata").
- **3 ingredientes añadidos seguidos → 1 sola llamada a `/api/v1/plan/reflow`** (debounce ~6 s);
  la clave `plan-recalc:*` de `localStorage` se limpia al terminar.
- `generateMonthlyPlan` sigue funcionando tras extraer `generatePlanBody` (200, 4 semanas,
  coverage `{7,30}` correcto a media de mes).
- Bundle de cliente sin referencias a `household.server`/`supabaseAdmin` (el `import type` se
  borra en compilación).

### Pendiente

- Pasada en el simulador iOS (paridad de disparos + copy).
- Guarda `not-planner` no probada en vivo (hace falta un 2º perfil con hogar); cubierta por
  lectura de código y `householdPlannerId`.
- Nota: si el creador de un hogar NO es el planificador y hace un cambio de mesa, el recálculo
  no salta en su dispositivo (la fila del plan es la del planificador). Caso raro (D3 cede el
  planificador al de más edad); lo cubre "Sincronizar" + la siguiente acción del planificador.
