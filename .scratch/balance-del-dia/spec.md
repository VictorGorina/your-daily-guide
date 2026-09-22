# Balance del día

Status: implementado (web + móvil), pendiente de aplicar la migración.

Un solo asentamiento por día en vez de tres, y una tarjeta en Hoy que enseña el efecto.

## El problema

Cada origen de desvío tenía su propio circuito, y los tres eran idénticos:

| Origen          | Libro de cuentas                 | Debounce                  | Decide             | Llama a IA    |
| --------------- | -------------------------------- | ------------------------- | ------------------ | ------------- |
| Cambio de plato | `habits[].swapKcalDelta`         | 10 s, `meal-swap-batch:`  | `compensationNeed` | `reflowMeals` |
| Picoteo         | `snacks.compensatedKcal`         | 10 s, `snack-settle:`     | `compensationNeed` | `reflowMeals` |
| Deporte         | `exercise.compensatedKcal`       | 10 s, `exercise-settle:`  | `compensationNeed` | `reflowMeals` |

Tres timers, tres claves de almacenamiento, tres suscripciones al cambio de visibilidad — y los
tres apuntando a la **misma ventana de 6 días** (`compensationWindow`) sin hablarse. Cada función
era correcta por separado; el fallo estaba en el átomo elegido. Se eligió el EVENTO cuando el
átomo real es el DÍA: la energía se suma en el cuerpo, no por origen.

De ahí salían dos fallos de exactitud, no solo llamadas de más:

1. **Se compensaba lo que se cancelaba solo.** Objetivo *mantener* (umbrales ±200). Picoteo +250 y
   deporte −300: el día real es −50, o sea nada. Pero picoteo cruzaba `above` y recortaba los días
   futuros, y deporte cruzaba `below` y les reponía energía. Dos llamadas de IA en direcciones
   opuestas sobre los mismos días, y en un orden no determinista (gana el timer que salte antes).
2. **Se ignoraba lo que sí había que compensar.** Cambio de plato +120 y picoteo +110: el día se
   fue +230, por encima del umbral. Ninguno llegaba a 200 en su propio libro, así que no pasaba
   nada. Choca de frente con la exactitud de macros como cimiento de la app.

El coste (hasta 3 `reflowMeals` al día donde debería haber 1, con su cuota `plan-adjust` y su tope
de gasto multiplicados por tres) es el tercer efecto, no el primero.

## La decisión: un solo asentamiento

`settleDay` ([src/lib/day-settle.functions.ts](../../src/lib/day-settle.functions.ts)) resuelve el
día de una pieza y sustituye a `compensateDishChanges`, `settleSnacks` y `settleExercise`:

1. Si vienen cambios de plato, sus desvíos se funden en `habits`.
2. Se suma el día entero (`dayBalance`) y se decide **una vez** (`compensationNeed`). Un día que se
   cancela solo no gasta ninguna llamada a la IA.
3. Si hay que compensar, se reservan los tres libros a la vez y se llama **una vez** a
   `reflowMeals` con la nota del día completo (`dayNote`).
4. El resultado se guarda a nivel de día (`daily_logs.adjustment`), que antes vivía triplicado.

Los tres libros de cuentas **se quedan donde estaban**: son la procedencia, y por tanto el desglose
que la tarjeta enseña. Mantienen además la garantía de no compensar dos veces lo mismo. Lo que
desaparece es que cada uno decidiera por su cuenta.

Beneficio extra: antes los tres asentamientos patcheaban columnas distintas de la MISMA fila de
`daily_logs`, cada uno con su guarda sobre `updated_at`, así que se invalidaban entre sí y
reintentaban. Ahora es una lectura y una escritura (`patchDay`).

### `dayReversing`, generalizado

Picoteo y deporte tenían cada uno su regla de "esto deshace una compensación ya aplicada". La
generalización es: `compensated ≠ 0 && sign(pending) ≠ sign(compensated)`. Reduce exactamente a las
dos reglas anteriores cuando solo hay un origen activo, y da la respuesta correcta cuando hay dos:
si ayer se recortaron cenas por un picoteo y luego se hace deporte, ese déficit es antes que nada
la devolución de aquel recorte, no un déficit fresco que convenga dejar estar.

## La cadencia: una pasada por ráfaga, no un cierre nocturno

Se consideró un cierre único al final del día (más exacto: el día ya está cerrado). Se descartó
**por la decisión de producto de abajo**: si el objetivo es que la persona VEA el efecto, diferirlo
horas lo esconde. Queda el debounce de 10 s compartido.

Que haya varias pasadas en un día no rompe nada porque `mergeDayAdjustment` las acumula (conserva el
plato de ANTES de la primera pasada y el de DESPUÉS de la última, y descarta el que volvió a quedar
igual): a las 22:00 la tarjeta lee como un solo ajuste coherente.

## La tarjeta "Balance de hoy"

Decisión de producto del usuario: **la persona tiene que ver que sus acciones tienen efecto sobre el
plan de los próximos días, porque eso es lo que genera confianza.** No es un aviso de "hecho", es
una cuenta que cuadra.

Va **debajo de "Registrar deporte"**, el último de los botones que la alimentan: todo lo que suma
queda por encima, así que se lee como el resumen de la pantalla.

```
Balance de hoy                +430 kcal
  Comidas cambiadas    +180
  Picoteo              +250
  Deporte              −200
He movido 3 platos de los próximos días para absorberlo.
  [Mié 24 · Cena]   ~~Lasaña boloñesa~~ → Merluza al horno
  [Jue 25 · Comida] ~~Arroz con costilla~~ → Ensalada de garbanzos
  Ver los 3 cambios
```

Tres cosas que la hacen funcionar:

- **El desglose por origen es la pieza clave.** Hace legible la causalidad: la persona ve sus tres
  palancas sumando a un solo número. Unificar no pierde la atribución, la gana — se ve la
  aritmética en vez de tres afirmaciones sueltas que no se hablan.
- **Dos tempos.** El número es inmediato (sale de la tabla de composición y de
  `estimateExerciseKcal`, deterministas: está calculado en cuanto se guarda). Los platos movidos
  tardan (ventana de calma + llamada al modelo); entre medias se dice "Ajustando tus próximos
  días…". Acuse de recibo instantáneo, consecuencia visible después.
- **Cuando el plan NO se mueve, también se dice** (`balanceNote`). Un "no he cambiado nada"
  explicado demuestra que el sistema estaba mirando, y es justo el caso que antes se quedaba mudo.
  El caso de dos orígenes que se anulan tiene frase propia ("El deporte compensa lo que has comido
  de más"), no cae en el genérico de "desvío pequeño".

### Lo que la tarjeta sustituye

- El bloque "qué ha pasado con el plan" de `snack-card` y de `exercise-card`. Las dos vuelven a ser
  solo la lista de lo apuntado.
- Las tres instancias de `AdjustmentInfoSheet`, que enseñaban el mismo reajuste con tres
  atribuciones distintas. Queda una, sin `dish` ni `verb`: el sujeto es el día.
- `snackOutcomeNote` + `exerciseOutcomeNote` → `dayOutcomeNote`. `mergeAdjustment` +
  `mergeExerciseAdjustment` (idénticas) → `mergeDayAdjustment`. `snackNote` + `exerciseNote` →
  `dayNote`.
- **El badge "i" de cada fila de comida.** Ese ya mentía: `compensateDishChanges` escribía el mismo
  `adjustmentChanges` en TODAS las comidas del lote, así que cambiar comida y cena hacía que las dos
  se atribuyeran la misma lista. El spinner por comida sí se queda (es por comida de verdad).

## Las cuatro puertas

Cambiar un plato no entra solo por la pestaña Hoy. `use-coach-actions.ts` (web y móvil) tiene su
propia puerta: pedirle al coach "cambia la cena" para HOY llamaba a `compensateDishChanges`, o sea
al camino viejo que decide con ese plato a solas. Esa puerta se redirigió a `settleDay` — si no,
cambiar un plato por chat seguiría decidiendo por origen, justo lo que esta feature quita.

`compensateFutureDishChange` (el coach cambia un plato de un día FUTURO, p. ej. "el jueves quiero
pollo") **no** cambia y sigue decidiendo sola: no es un desvío de hoy, no hay nada que sumarle, y
no pasa por `habits`.

## Migración

```sql
ALTER TABLE public.daily_logs ADD COLUMN IF NOT EXISTS adjustment jsonb;
```

[supabase/migrations/20260921120000_daily_logs_adjustment.sql](../../supabase/migrations/20260921120000_daily_logs_adjustment.sql).
Se aplica pegándola en el SQL Editor del panel de Supabase (no hay CLI).

**El código funciona sin ella**: `readDayRow` detecta el 42703 una vez y sigue sin la columna, igual
que hace `reflowMeals` con `snacks`. Se compensa exactamente igual; lo único que no se puede es
enseñar los platos movidos ni el motivo por el que no se movió nada, porque no hay dónde
guardarlos. Un despliegue por delante de la migración no deja la app sin compensar.

Los días ya cerrados conservan sus copias antiguas (`snacks.adjustment`, `exercise.adjustment`,
`habits[].adjustmentChanges`) y el detalle de un día pasado las sigue leyendo — `dayMovedChanges`
mira primero el registro del día y cae a los tres sitios antiguos, deduplicando por celda.

## Archivos

**Nuevos:** `src/lib/day-balance.ts` (+ test), `src/lib/day-settle.ts`,
`src/lib/day-settle.functions.ts`, `src/components/day-balance-card.tsx`,
`src/routes/api/v1/day/settle.ts`, la migración, y sus espejos en `mobile/`.

**Borrados:** `src/lib/snack-settle.ts`, `src/lib/exercise-settle.ts` (+ espejos móviles),
`settleSnacks`, `settleExercise`, `compensateDishChanges`, y los helpers que quedaron huérfanos
(`mergeAdjustment`, `mergeExerciseAdjustment`, `snackNote`, `exerciseNote`, `snackOutcomeNote`,
`exerciseOutcomeNote`, `dishChangeNote`).

`/api/v1/snacks/settle`, `/api/v1/exercise/settle` y `/api/v1/plan/compensate` se conservan como
alias de `day/settle`: las builds móviles ya instaladas siguen llamando ahí y deben seguir
compensando. Las tres aceptan lo que ya mandaban; solo cambia la forma de la respuesta (`outcome` en
vez de `adjusted`), y una build vieja que lea `adjusted` simplemente no pinta la frase de "he
ajustado N comidas" — el plan se recoloca igual.

## Verificado

- `lint`, `typecheck` (web y móvil), `bun test` (519 tests).
- **Web, perfil demo:** picoteo de 250 kcal sobre un cambio de plato de +180 → la tarjeta salta a
  `+430` al instante con las dos líneas, "Ajustando tus próximos días…", y **una sola** petición a
  `settleDay` (200). En base de datos, las dos libretas reservadas en la misma pasada
  (`swapCompensated: true` y `compensatedKcal: 250`). Ese +180 solo, por debajo del umbral, antes se
  habría ignorado en silencio.
- **Simulador iOS, perfil demo:** deporte de 30 min → `−300 kcal · Deporte −300 · Ajustando…`, y
  `exercise.compensatedKcal: −300` al terminar. La tarjeta de deporte queda solo como lista.
- **No verificado:** el estado "He movido N platos" con sus chips, porque necesita la columna nueva.
