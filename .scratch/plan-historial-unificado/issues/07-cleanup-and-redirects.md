# 07 — Limpieza: borrar Historial, repuntar redirects, docs

Status: todo
Blocked by: 06

## Tareas

1. **Borrar** `src/components/historial-section.tsx` y `mobile/components/historial-section.tsx`
   una vez que `plan.tsx` ya no los importa. Revisar el helper `iso` local por si lo usa otro
   archivo (grep).
2. **Borrar** `AdherenceHeatmap` (vivía dentro de `historial-section.tsx`; confirmar que no se
   exporta ni se usa fuera).
3. `src/routes/_authenticated/historial.tsx`: `redirect({ to: "/plan", search: { tab: "historial" } })`
   → `redirect({ to: "/plan" })`.
4. `mobile/app/(app)/historial.tsx`: `<Redirect href="/plan?tab=historial" />` →
   `<Redirect href="/plan" />`.
5. `src/routeTree.gen.ts`: se regenera solo al arrancar `bun run dev`; **no** editar a mano.
   Confirmar que el diff generado es coherente.
6. Grep final de `historial` en `src/` + `mobile/` (excl. `routeTree.gen.ts`, textos de
   privacidad, comentarios sobre "tu historial"): no debe quedar ninguna referencia de tab.
7. **Docs**:
   - `CLAUDE.md`: quitar la línea "No hay suite de tests en este repo" (hay `bun test`);
     actualizar la sección "Arquitectura de la web" / Plan → 2 subpestañas + navegación de meses.
   - `AGENTS.md`: párrafo corto sobre la navegación de meses de Plan y la barrera de
     `generateMonthlyPlan` (no meses pasados; mes+1 solo la última semana).
8. Escribir memoria nueva (`plan-mes-navegacion.md` o similar) resumiendo D1-D7 del spec —
   **solo cuando el feature esté mergeado**, no antes.

## Hecho cuando

- `bun run build` + `bun run typecheck` + `bun run lint` + `bun test` limpios.
- `/historial` (web) y `/historial` (mobile) redirigen a `/plan` sin parámetro.
- No queda `historial-section` en el árbol.
