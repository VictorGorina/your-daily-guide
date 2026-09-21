# 01 · Trigger en Postgres para los nombres del hogar

Status: abierto

## Contexto

`assertCleanName` (en `src/lib/household.ts` y su copia `mobile/lib/household.ts`) rechaza un
nombre obsceno de miembro de la mesa, de un peque o de `profiles.display_name`. Pero esas
escrituras van **del navegador directo a Supabase** — `addAdultSlot`, `updateMember`, `addChild`,
`updateChild`, `saveProfile` —, sin server function de por medio, así que no hay ningún
`.validator()` donde engancharlo. El guard avisa, no es una frontera: cualquiera con la clave
anónima puede saltárselo con una llamada REST.

A diferencia de un plato, el alcance del daño es pequeño (lo ve su propio hogar), por eso no
entró en el cambio inicial.

## Qué haría falta

Un trigger `BEFORE INSERT OR UPDATE` sobre `household_members.display_name`,
`household_children.name` y `profiles.display_name` que rechace el subconjunto inequívoco de
`BLOCKED_TERMS`. La lista quedaría duplicada (TS + SQL); es corta y estable, pero cada cambio
pediría una migración.

Alternativa más cara y más consistente con la arquitectura: mover esas escrituras a server
functions con su espejo `/api/v1/*`, y entonces vale el mismo `assertCleanFood` de siempre.
