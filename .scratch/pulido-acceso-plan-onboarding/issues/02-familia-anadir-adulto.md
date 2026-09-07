# 02 — Familia: por qué falla "Añadir adulto" y dejar de ocultarlo

Status: sin empezar
Incidencia del usuario: ⓷

## Objetivo

Que añadir a alguien a la mesa funcione para quien tiene derecho a hacerlo, y que cuando no
funcione se diga el motivo en vez de esconder el formulario o tragarse el error.

## Contexto

**El fallo no se pudo reproducir**: probado en vivo con perfil demo siendo el creador, el
`INSERT` devuelve 201 y la fila aparece en la mesa y en el horario. Ver `../spec.md` (⓷) para
las dos causas plausibles que sí están en el código.

## Tareas

1. **Dejar de tragarse el error** (`src/routes/_authenticated/hogar.tsx:207`): el `onError` de
   `addAdult` recibe el error y lo descarta. Propagar el mensaje real, como ya hacen
   `makePlanner` y `persistShared` en ese mismo fichero (`onError: (e: Error) => toast.error(e.message)`).
2. **Permitir añadir al planificador, no solo al creador**:
   - Migración nueva en `supabase/migrations/`: sustituir la policy
     `"creator inserts household slots"` (y sus hermanas de UPDATE/DELETE) para que acepten
     también a quien tiene `is_planner` en ese hogar. Ojo: aplicar el SQL a mano en el SQL
     Editor del panel; no hay CLI de Supabase en este proyecto.
   - Alinear la condición `isCreator` de la UI con la policy nueva, o el formulario seguirá
     escondido aunque la base de datos ya lo permita.
3. **Explicar en vez de ocultar**: si la persona no puede añadir a nadie, enseñar una línea
   ("Solo quien creó la familia o quien planifica puede añadir gente a la mesa") en lugar de
   no renderizar el bloque, que es lo que hace hoy el ternario `isCreator ? … : null`.
4. **Móvil**: replicar 1 y 3 en `mobile/app/(app)/hogar.tsx`, que tiene la misma estructura.

## Verificación

- Perfil demo A crea hogar y añade a "Marta" → aparece con chip "Pendiente".
- Perfil demo B reclama el hueco y se le nombra planificador → **puede** añadir a alguien.
- Perfil demo C se une como miembro normal → ve la explicación, no un hueco vacío.
- `bun run lint` / `typecheck` / `test` verdes.

## Hecho cuando

Cualquier fallo al añadir a alguien produce un mensaje concreto en pantalla, y el planificador
puede gestionar la mesa. **Confirmar con el usuario que su caso concreto queda resuelto** — el
síntoma original sigue sin reproducirse.

## Notas

Si tras esto el usuario sigue diciendo que "no funciona", conviene descartar que lo que
esperaba fuese el issue 05: añadir a alguien y que el plan y la compra se recalculen solos.
