# 08 — Coach, adjust, traspaso de planificador y copy

Status: resolved
Blocked by: 05, 07

## Objetivo

El coach y los textos de la app hablan del plan del hogar con propiedad, sin dar por hecho
"tu plan" cuando es el de la casa.

## Tareas

1. `src/lib/household.server.ts` `householdContext` → texto para el prompt:
   - Roster: "En casa: {nombres adultos con app} (con cuenta), {nombres sin app} (sin
     cuenta), niños {nombre (edad, alergias)}. Planifica y compra: {nombre del planificador}."
   - Raciones por comida compartida (de 04).
   - Slots compartidos descritos (`describeSharedSlots`).
   - Regla: "En las comidas compartidas el plato es el mismo para todos; los ajustes de
     ración de cada persona son privados (‘comí distinto’). Los platos de niño van en
     `days[].kids`."
2. `adjustMonthlyPlan`:
   - No planificador que pide tocar un slot compartido → responder "eso lo lleva {nombre} de
     tu casa; puedo ajustar tus comidas en solitario" (D2: los slots compartidos, platos y
     días, solo los toca el planificador). Sí puede recolocar sus comidas en solitario.
   - Planificador → recoloca sus futuros y re-espeja; el `summary` mantiene "También he
     ajustado las comidas compartidas de tu hogar" cuando `synced > 0`.
3. **Traspaso de planificador (D3).** `leaveHousehold` y el borrado de cuenta
   (`account.functions.ts`), cuando el que sale es `is_planner`, llaman a
   `reassign_planner(householdId)` (RPC de 01). Verificar que el nuevo planificador ve la
   lista de la casa como suya (editable) y que el espejo sigue funcionando. Si el hogar se
   queda sin miembros con cuenta, `is_planner` queda vacío y `syncSharedMeals` no hace nada
   (sin romper).
4. `welcomeBriefing`: si el usuario es no planificador, el mensaje de bienvenida explica que
   el plan de comidas compartidas lo lleva otra persona de la casa y que él planifica sus
   comidas en solitario, registra lo que come y marca la compra.
5. Push / repaso nocturno (`push-dispatch.server.ts`, `NightlyReviewSheet`): revisar copy —
   "prepara el plan del mes que viene" solo tiene sentido para el planificador; para el resto,
   omitir ese push o cambiar el texto.
6. `profiles.family_context` sigue existiendo; el coach lo usa como color, pero el roster
   estructurado manda.

## Verificación

Perfil demo planificador y perfil demo no planificador: preguntar al coach "¿qué ceno hoy?"
y "cámbiame la cena del sábado" desde cada uno; comprobar que las respuestas y los cambios
son coherentes con quién es cada uno. Revisar el mensaje de bienvenida de un no planificador.

## Hecho cuando

El coach describe bien la familia y el reparto de roles; el copy no llama "tuyo" al plan del
hogar; lint/typecheck verdes; replicado en móvil donde aplique.

## Answer

Hecho (2026-09-01), web. Sin commitear, encima de issue 07 en la rama
`familia-comidas-compartidas`. Gates verdes: web `lint` 0 errores / `typecheck` / 122 tests
(+2); móvil `tsc` 0. **Nada que replicar en `mobile/`**: es todo prompt y copy de servidor
(`*.server.ts` + ruta `/api/chat`), y la app nativa lo consume por el mismo backend.

### Tarea 1 — `householdContext` con roster nombrado + reglas

- `describeRoster(members, children)` nuevo en `src/lib/household-shared.ts` (helper puro,
  con test): "Comen juntos en casa: Ana y Luis (con la app), Abuela (sin la app, solo
  cuentan para la compra). Niños: Leo (5 años), alergia a huevo… Planifica el menú y hace
  la compra de la casa: Ana." Se queda solo en la web — el `household-shared.ts` de móvil
  es un subconjunto declarado (sin `describeSharedSlots`/`servingsPerSlot`), y esto es
  texto de prompt de servidor.
- `householdContext.text` (`src/lib/household.server.ts`) reescrito para juntar
  `describeRoster`, `describeSharedSlots`, las notas libres de cada niño, `describeServings`
  y la regla nueva ("en una comida compartida el plato es EXACTAMENTE EL MISMO para toda la
  mesa y solo lo cambia {planner}; que alguien coma una ración distinta o se salte una
  comida es privado; el plato de niño va en `days[].kids`"). El campo `text` es lo único que
  cambia; `members` / `children` / `servings` quedan intactos (los consumen
  `generateMonthlyPlan`, el espejo, etc.).

### El coach de chat recibe el contexto del hogar (hueco de issue 07)

`/api/chat` era un handler HTTP que solo sacaba `userId` y llamaba
`coachSystemPrompt(profile)` sin nada del hogar — por eso `cambiar_plato_nino` casi nunca
se disparaba.

- `supabaseFromRequest(request)` nuevo en `src/lib/api-auth.server.ts`: como
  `getRequestUserId` pero devuelve además un cliente Supabase ligado al JWT del usuario
  (RLS), reutilizando el mismo `serverClient` extraído. `/api/chat` lo usa y pasa
  `home.text` a `coachSystemPrompt`.
- `householdCoachRules(home, userId)` (en `chat.ts`, solo con `actions`): para el
  **planificador** con niños, la lista de niños con alergias y "usa cambiar_plato_nino, no
  cambiar_plato". Para un **no planificador**, nombra a quien planifica y prohíbe llamar a
  `cambiar_plato`/`cambiar_plato_nino` para una comida compartida y ofrecer "cambiarlo para
  toda la mesa"; le deja tocar solo sus comidas en solitario. Colocado arriba del prompt
  (tras el bloque del hogar), no al final. La línea genérica de "plato de un niño" del
  bloque de acciones se ajustó para no invitar a probar la herramienta cuando no toca.
- Web (chat + coach-fab) y móvil pegan contra `/api/chat`, así que las tres superficies se
  arreglan de una vez sin tocar cliente.

### Tarea 2 — `adjustMonthlyPlan`

Ya resuelto en issue 05: REGLA 5 en el prompt para el no planificador + congelado mecánico
(`composeMonthlyPlanForMember`) + `summary` diferenciado ("esas las lleva {planner}" /
"También he ajustado las comidas compartidas de tu hogar" con `synced > 0`). Sin cambios.

### Tarea 3 — Traspaso de planificador (D3)

Ya lo hace **la BD**, no hace falta código nuevo. La migración de issue 01
(`20260901160000_household_roster.sql`) define el trigger
`household_members_planner_handoff` `AFTER DELETE ON household_members` que llama a
`household_assign_oldest_planner(household_id)` siempre que se borra un miembro que era
`is_planner`, venga por donde venga el borrado:

- `leaveHousehold()` → `DELETE FROM household_members WHERE user_id = …` → trigger.
- `deleteAccount` → borra el usuario en Auth → `household_members.user_id` tiene
  `ON DELETE CASCADE` a `auth.users` → se borra la fila → trigger.

Si no queda ningún miembro con cuenta, `is_planner` queda vacío y `syncSharedMeals`
(`if (!ctx.plannerId) return { synced: 0 }`) no hace nada. **Pendiente de verificar en
vivo** (escenario 8 de issue 09): A planificador sale → B pasa a ver la compra de la casa
como suya y el espejo sigue.

### Tarea 4 — `welcomeBriefing`

`src/lib/plan.functions.ts`: carga `householdContext`; si el usuario es no planificador del
hogar, el prompt cambia a explicar que el menú compartido y su compra los lleva
`{planner}`, y que él planifica en solitario, registra lo que come y marca la compra.
También pasa `home.text` a `coachSystemPrompt`. (Solo se ejecuta al final del onboarding;
caso raro pero cubierto.)

### Tarea 5 — Push de renovación

`src/lib/push-dispatch.server.ts`: el `NightlyReviewSheet` no menciona el plan del mes, así
que no se toca. El push de renovación sí daba por hecho "prepara tu plan": ahora, para los
`renewalMatches`, una consulta a `household_members` marca los no planificadores y les manda
`renewalCopyMember` ("El menú de tu casa lo renueva quien planifica. Abre la app para
preparar tus comidas en solitario de {mes}.") en vez de `renewalCopy`.

### Tarea 6 — `family_context`

Sin cambios: `coachSystemPrompt` ya lo imprime como "Entorno familiar", y ahora el roster
estructurado va aparte en el bloque "Hogar y comidas compartidas".

## Verificación (2026-09-01)

Navegador, demo **no planificadora Marta** (hogar `B27FAY3V`, planifica Alex, `shared_slots`
= cena L–D, confirmado leyendo la rejilla). Turnos nuevos con el código de este issue:

- "Cámbiame la comida del jueves por ensalada de garbanzos" (comida NO es slot compartido) →
  "¡Hecho! Tu comida del jueves, 3 de septiembre, será…" — resuelve la fecha, sin errores de
  servidor: `cambiar_plato` sobre su fila propia, correcto para un no planificador.
- "Ponme pescado a la plancha para la cena de mañana" / "…lentejas…" (cena SÍ es compartida)
  → el coach no aplica nada, dice "las cenas las planifica Alex en tu casa" y "habla con
  Alex". **Nunca finge** que ha cambiado el plato compartido.
- El coach conoce el roster (nombra a Alex como planificador, sabe qué comidas se comparten).

`/api/chat` responde sin 500 con `supabaseFromRequest` + `householdContext` — era el camino
crítico. Plan de Marta sigue mostrando "Las comidas compartidas de tu casa las lleva Alex".

**Flojo, no bloqueante:** Gemini Flash fraseó la negativa de la comida compartida como
pregunta blanda ("¿quieres que cambie el plato de la mesa…?") en vez de un "no puedo" seco.
Amplificado por historial de conversación de una sesión previa (turnos "pizza" y un "Leo"
que fingía éxito, anteriores a este código; el chat va por fecha y no hay forma de
limpiarlo desde la UI). El candado real es de servidor (`guardSharedSlotWrite`,
`setChildMeal` con guard D2) y está verificado en issues 05/07. Prompt afinado dos veces.

**Sin verificar en vivo:** camino del planificador con niños (`cambiar_plato_nino` feliz),
`welcomeBriefing` de no planificador (solo onboarding), push de renovación (solo cron),
traspaso D3 (escenario 8 de issue 09), simulador iOS (no aplica: sin cambios de cliente).
