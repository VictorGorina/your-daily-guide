# 08 — Coach, adjust, traspaso de planificador y copy

Status: todo
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
