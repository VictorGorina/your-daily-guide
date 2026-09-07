# 05 — Recálculo automático del plan al cambiar despensa o miembros

Status: sin empezar
Incidencia del usuario: ⓻
Blocked by: 03

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
