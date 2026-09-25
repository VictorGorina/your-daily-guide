# 18 — Puente: medir lo que absorbe el reajuste actual

Status: implementado (2026-09-25, sin desplegar)
Blocked by: 06
Tamaño: S
Fase: 2
Se retira con: el ticket 12

## Qué

Mientras la compensación la siga haciendo la IA cambiando platos (`reflowMeals`, hasta el 12), el
código **mide** cuántas kcal mueven de verdad sus cambios. Si se queda muy corto, insiste una vez con
los números, y la tarjeta "Balance de hoy" dice lo que se movió de verdad.

## Por qué

- H19: hoy basta con que cambie un plato (`day-settle.functions.ts:428`). Cambiar unas lentejas por
  garbanzos cuenta como "compensado" aunque mueva 30 kcal de 400.
- La tarjeta existe para que la persona **vea** que lo que hace mueve el plan (memoria
  `plan-changes-visible-to-user`). Si lo que enseña no está medido, la confianza que genera es
  falsa.
- El 12 lo resuelve de raíz, pero depende del escalado (08). Con la caché (06), medir cuesta casi
  nada.

## Diseño

- En `settleDay`, después de `reflowMeals`: `absorbed = Σ (kcal después − kcal antes)` sobre
  `futureChanges`, con `getRecipes` (caché) en la misma base con la que se midió el desvío (ración
  base hasta el 08; factores después).
- Si `|absorbed| < 50 % × |pending|` → **una** insistencia a `reflowMeals` con los números: "tus
  cambios mueven 80 de 400 kcal; faltan unas 320". Sustituye a la insistencia genérica actual
  (`strongDelta` sin cambios, `FORCE_ADJUST_KCAL`).
- `DayAdjustment.absorbedKcal` se guarda con el ajuste. La tarjeta lo enseña:
  - Con `mostrar`: "He movido unas 350 kcal de tus próximos días".
  - Con `ocultar`: "He aligerado un poco tus próximas cenas".
  - Si se queda corto tras insistir: "He ajustado una parte; el resto no lo persigo".

## Archivos

- `src/lib/day-settle.functions.ts`, `src/lib/plan.functions.ts` (`reflowMeals`: nota con números)
- `src/lib/day-balance.ts` (`DayAdjustment`), `src/components/day-balance-card.tsx` y móvil

## Criterios de aceptación

- [ ] Test (puro) del cálculo de `absorbed` con cambios de plato conocidos.
- [ ] Navegador (perfil demo): pizza y cerveza → la tarjeta enseña kcal movidas coherentes con los
      platos cambiados.
- [ ] Log: proporción `absorbed / pending` por asentamiento, para comparar después con el 12.

## Comments

- 2026-09-25 — **Implementado**: `reflowMeals({ measure: true })` mide con las recetas
  (`absorbedKcal`), insiste UNA vez con los números por debajo del 50 %, guarda
  `DayAdjustment.absorbedKcal`/`partial` y la tarjeta lo dice (`absorbedNote`), web y móvil. Log
  `reflowMeals: absorbido {ratio}` para compararlo con el 12.
