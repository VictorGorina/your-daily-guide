# 16 — Deporte: gasto con el peso, neto y sin contar la rutina dos veces

Status: ready si se aprueba D9
Blocked by: 07
Tamaño: M
Fase: 2

## Qué

"Registrar deporte" calcula las kcal con el peso de la persona y en **neto**: solo lo que se gasta
por encima del reposo, que ya está en el gasto diario. Solo compensa el deporte **que pasa de su
rutina** de la semana, porque la rutina ya va dentro del objetivo (07, D9).

## Por qué

- H20: `estimateExerciseKcal` ([src/lib/exercise.ts](../../../src/lib/exercise.ts)) da 300 kcal por
  30 min de correr a cualquiera. Lo real (neto) es ~220 a 50 kg y ~440 a 100 kg. Al contar el
  bruto, caminar se infla ~30 %.
- En cuanto el 07 meta la rutina en el objetivo, registrar esas sesiones las contaría **dos veces**.
  Alguien que entrena 3 días comería de más ~600-900 kcal a la semana.

## Diseño

### 1. Kcal netas con el peso — `exerciseNetKcal` (puro, `src/lib/nutrition/exercise-energy.ts`)

- `kcal = (MET − 1) × kg × minutos / 60`.
- La tabla MET por actividad × intensidad la crea el 07 (valores del Compendio de Actividades
  Físicas 2024, a verificar al implementar). Valores orientativos:

  | Actividad | Suave | Normal | Fuerte |
  |---|---|---|---|
  | Correr | 8,0 | 9,8 | 11,5 |
  | Caminar | 3,0 | 3,5 | 4,3 |
  | Bici | 5,8 | 7,5 | 10,0 |
  | Gimnasio / pesas | 3,5 | 5,0 | 6,0 |
  | Natación | 5,8 | 7,0 | 9,8 |
  | Otra | 4,0 | 5,0 | 6,0 |

- El peso sale de `current_weight_kg` (70 si falta).
- `estimateExerciseKcal` pasa a ser una envoltura de `exerciseNetKcal` con el peso. El selector de
  Hoy no cambia; solo la cifra que enseña antes de guardar.

### 2. La rutina no se compensa (D9)

- La rutina de la persona está en `profiles.training` (07): `{ sessions_per_week, minutes, activity,
  intensity }`.
- Semana ISO (lunes a domingo). Al guardar una sesión:
  - Si en la semana hay **menos sesiones registradas que las de la rutina**, esta es de rutina. Su
    parte "normal" (`exerciseNetKcal` de la sesión típica) ya está en el objetivo. Solo cuenta como
    extra lo que **pase** de una sesión típica: 90 min cuando la rutina es de 45 cuenta el exceso.
  - Si ya se completó la rutina, la sesión entera es extra.
- `ExerciseEntry` gana `routine: boolean` y `routineKcal`. Su `kcal` (negativo) es **solo la parte
  extra**, que es lo que entra en `dayBalance` y en `settleDay`. Las entradas antiguas, sin campo,
  cuentan enteras como extra, como ahora.
- **Sin rutina** declarada (o perfil antiguo sin rellenar, ver 07): todo lo registrado es extra.
- Deshacer una sesión de rutina no devuelve nada. Deshacer una extra devuelve su parte, con la
  lógica de siempre (`compensatedKcal`).

### 3. Qué ve la persona

- En la lista de deporte: "Correr 40 min · dentro de tu rutina (2 de 3 esta semana) · ya está en tu
  plan". O "· 280 kcal extra" (con `mostrar`).
- En "Balance de hoy", la línea de deporte enseña solo el extra. `balanceNote` explica "Tu rutina ya
  va en tu plan" cuando el deporte de hoy fue solo rutina.

## Archivos

- `src/lib/nutrition/exercise-energy.ts` + test (lo crea el 07; aquí se amplía)
- `src/lib/exercise.ts`, `src/lib/exercise.functions.ts`, `src/lib/day-balance.ts`
- `src/components/exercise-card.tsx`, `day-balance-card.tsx` y sus equivalentes en móvil
- Copias en `mobile/lib/` (`exercise.ts`, `day-balance.ts`)

## Criterios de aceptación

- [ ] Test: 30 min de correr normal → ~220 kcal a 50 kg y ~440 a 100 kg.
- [ ] Test: con una rutina de 3 × 45 min, las sesiones 1-3 de la semana no generan desvío, la 4.ª sí,
      y una de 90 min cuenta 45 min de extra.
- [ ] Test: una entrada antigua sin `routine` cuenta entera como extra.
- [ ] Navegador (perfil demo con rutina): registrar la 1.ª sesión de la semana → "dentro de tu
      rutina" y el plan no se mueve.
- [ ] Simulador iOS: mismo caso.

## Comments
