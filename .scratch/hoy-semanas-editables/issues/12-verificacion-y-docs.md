# 12 — Verificación de extremo a extremo y documentación

Status: ready
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11
Tamaño: S

## Qué

Pasar el recorrido completo en las dos plataformas, revisar contra las convenciones del proyecto y
dejar la documentación al día.

## Recorrido

1. `bun run lint && bun run typecheck && bun run test` (+ `bun run format`).
2. Simulador iOS (primero) y navegador con el **perfil demo** (viewport 375 px):
   - abrir Hoy → semana actual sin salto;
   - deslizar hasta la semana del alta y hasta la última permitida;
   - ayer: lápiz en la casilla y en las comidas → corregir a "Comí distinto" → cambian las macros;
   - pasado mañana: cambiar la cena a algo muy distinto → deshacer → volver a cambiar → esperar la
     compensación → "Ver" enseña los cambios;
   - cambio parecido → sin compensación;
   - Hoy, "Comí otra cosa" con un plato muy distinto → badge "i"; con uno parecido → sin badge;
   - coach: cambiar un plato de hoy y uno futuro → compensación automática, sin `ajustar_plan_mensual`;
   - ayer: "Comí distinto" con un plato muy distinto → compensa; hace 4 días → solo historial;
   - Plan → calendario: el lápiz de días pasados también está;
   - reducir movimiento: solo fundidos.
3. Dejar el perfil demo como estaba.
4. `/senda-review` sobre el diff completo.

## Documentación

- CLAUDE.md: nueva sección "Pestaña Hoy — tira de la semana" (límites, pasado vs. futuro, `pinned`);
  sección "Compensación de un cambio de plato" (lote común, tabla de umbrales, las tres entradas);
  corregir "Un cambio a mano…" y reescribir "Cambiar un plato en Hoy".
- AGENTS.md: explicación larga de la compensación y su encaje con `precision-nutricional/12`.
- `docs/agents/testing.md`: filas de `week-nav.test.ts` y `compensation.test.ts`, y ampliar las de
  `plan-shared.test.ts` y `macros.test.ts`.

## Criterios de aceptación

- [ ] Capturas de cada paso en las dos plataformas.
- [ ] `/senda-review` sin hallazgos abiertos.
- [ ] Documentación actualizada.

## Comments
