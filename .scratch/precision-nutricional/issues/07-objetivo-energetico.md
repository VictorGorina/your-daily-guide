# 07 — Objetivo energético personal (en código) y una sola cifra en toda la app

Status: done en código (2026-09-25); falta aplicar la migración y el relleno
Blocked by: 01
Tamaño: L
Fase: 1

## Qué

- `energyTargets(profile)` calcula en código las kcal y macros diarias de cada persona y su reparto
  por comida, a partir de los datos del onboarding **normalizados**.
- Es **la única cifra de objetivo de la app**: barra de Hoy, semáforo del calendario, texto de la
  guía, coach y notificaciones salen de aquí.
- Lo que se enseña depende de `nutrition_numbers` (ticket 01).

## Por qué

- H1: sin objetivo, "la cantidad correcta" no existe; solo hay una ración estándar.
- H13: Hoy enseña dos objetivos a la vez. Uno es el texto `guide.calories`, que escribe el modelo;
  el otro, la barra, que mide contra la suma del plan.
- H14: el semáforo mide contra la suma del plan. Si alguien come el plan, sale verde aunque el plan
  esté un 58 % por debajo de lo que necesita.
- H15: `activity_level` tiene cuatro vocabularios y mezcla el día a día con el deporte. Con el mapeo
  original de este ticket, "muy activo" caía en 1,375 (−20 % de gasto).

## Diseño — `src/lib/nutrition/energy.ts` (puro)

### 1. Entradas normalizadas (antes de calcular)

- **Actividad del día a día**, sin contar el deporte: `daily_activity` con estos valores:
  - `sentado` 1,2 (oficina, estudiar);
  - `de_pie` 1,375 (tienda, docencia, casa con niños);
  - `fisico` 1,55 (hostelería, reparto);
  - `muy_fisico` 1,725 (obra, campo, almacén).
- **Rutina de entrenamiento** (D9): `training = { sessions_per_week, minutes, activity, intensity }`,
  con las actividades e intensidades de `EXERCISE_ACTIVITIES` y `EXERCISE_INTENSITY`.
- **Onboarding sin preguntas nuevas** (memoria `onboarding-direction`). La pregunta actual ya pide
  las dos cosas ("Nivel de base… y tipo y frecuencia"). Lo que cambia es la extracción de
  `parseOnboarding`: devuelve `daily_activity` y `training` en vez de un `activity_level` que las
  mezcla.
- **Ajustes:** chips de `daily_activity` y un campo corto para la rutina ("3 × 45 min · gimnasio ·
  normal"). El coach puede cambiarlos (`actualizar_perfil`).
- **Valores antiguos:** `normalizeActivity(activity_level)` los traduce así:
  - `sedentario` → `sentado`;
  - `ligero` y `activo ligero` → `de_pie`;
  - `moderado` y `activo` → `fisico`;
  - `alto` y `muy activo` → `muy_fisico`.

  Esos valores ya incluían el deporte. Por eso, **mientras `training` esté vacío** en un perfil
  antiguo, su PAL se usa tal cual, sin sumar rutina, y todo el deporte que registre cuenta como
  extra (16).
- **Relleno, una sola vez:** un script con un modelo barato, offline, extrae `daily_activity` y
  `training` de `exercise` y `life_context` de las cuentas existentes. Lo que no se entienda se
  queda con la normalización.
- **Test:** ningún valor de `activity_level` presente en producción cae en "sin dato". Se comprueba
  con una consulta de solo lectura de los valores distintos.

### 2. Gasto

- **Metabolismo basal (Mifflin-St Jeor):** `10·kg + 6,25·cm − 5·edad + s`, con `s = +5` hombre,
  `−161` mujer y `−78` (la media) para "otro" o sin dato.
- **Edad:** `ageFromDOB` ([src/lib/age.ts](../../../src/lib/age.ts)).
- **Peso:** `current_weight_kg` (lo actualiza la herramienta `actualizar_peso` del chat).
- **Rutina:** `sessions_per_week × exerciseNetKcal(activity, minutes, intensity, kg) / 7`.
  - `exerciseNetKcal = (MET − 1) × kg × h`, en un módulo puro `exercise-energy.ts` que se crea aquí y
    reutiliza el 16.
  - La tabla MET sale del Compendio de Actividades Físicas 2024; los valores se verifican al
    implementar.
- `TDEE = basal × PAL(daily_activity) + rutina`. Sin dato de actividad → `de_pie` y sin rutina.
- Si el 19 se aprueba, el gasto se multiplica por `expenditure_factor` (1 por defecto).

### 3. Ajuste por objetivo (dirección con `deriveGoalType` de `src/lib/daily.ts`)

| Caso | kcal |
|---|---|
| perder | `TDEE × 0,80`, sin bajar más de 500 kcal, con suelo `max(basal, 1200 mujer / 1500 hombre / 1350 otro)` |
| ganar | `TDEE × 1,10`, sin subir más de 300 kcal |
| mantener o sin objetivo | `TDEE` |
| embarazo | nunca déficit; `TDEE + 300` (no sabemos el trimestre) |
| lactancia | nunca déficit; `TDEE + 400` |
| menor de 18 | `null`: la fórmula no está validada; se usa la ración por sexo (21) |
| faltan altura, peso o edad | `null` → comportamiento actual |

- Una fecha objetivo que pida más ritmo **no** cambia estos topes (misma regla que el prompt del
  coach: se ajusta la fecha, no el hambre).
- Las marcas del 15 (enfermedad renal, diabetes…) se aplican encima, solo en el sentido más
  prudente.

### 4. Macros

- **Peso de referencia para la proteína:** si el IMC es > 30, el peso con IMC 27 (`27 × altura²`);
  si no, el peso actual.
- **Proteína:** 1,2 g/kg de referencia; 1,6 g/kg si pierde peso o entrena fuerza
  (`strength_training_experience` distinta de "ninguna", o una rutina de `Gimnasio / pesas`). Tope:
  2,0 g/kg y 30 % de las kcal. El 15 puede bajarlo (enfermedad renal).
- **Grasa:** 30 % de las kcal (mínimo 25 %).
- **Fibra:** 14 g por cada 1.000 kcal.
- **Carbohidratos:** lo que queda.

### 5. Reparto por comida

Pesos base: desayuno 0,25 · comida 0,35 · cena 0,28 · merienda 0,12. Se renormalizan sobre
`effectiveMealSlots(profile)`. Una comida fuera de casa conserva su parte del objetivo, pero su plato
no se escala (restaurante).

### 6. Salida

```ts
type EnergyTargets = {
  kcal: number; protein_g: number; fat_g: number; carbs_g: number; fiber_g: number;
  perSlot: Record<MealSlot, { kcal: number; protein_g: number }>;
  basis: { bmr: number; pal: number; routineKcal: number; tdee: number; adjustment: number;
           refWeightKg: number; legacyActivity: boolean };
} | null;
```

### 7. Una sola cifra en toda la app

- `generateDailyGuide` devuelve `targets` y **guarda una copia en la guía del día**
  (`guide.targets`). Así el semáforo de un día pasado se mide contra el objetivo que tenía ese día,
  no contra el de hoy.
- `calories` (texto) se construye en código: "entre X y Y kcal" (objetivo ±7 %, redondeado a 50).
  El modelo deja de escribir esa cifra. Con `ocultar`, un texto sin cifras.
- `MacroBars` (web y móvil): `target` = `targets`. `macroTargets` (250 g de carbohidratos y 70 g de
  grasa fijos) queda solo para `targets == null`.
- **Semáforo:** `daySignal` y `daySignalOf` (web y móvil) miden contra `guide.targets.kcal`. Los
  días sin copia (anteriores a este ticket) caen a `macroEstimate`, como ahora.
- `coachSystemPrompt`: con `mostrar`, una línea "Objetivo orientativo: ~1.730 kcal y 112 g de
  proteína al día", para que el chat no contradiga a la app. Con `ocultar`, no se añade.
- Notificaciones que citen cifras: del mismo objetivo.
- Un plato que aún no se ha podido calcular no cuenta y se dice ("Calculando…", ticket 13). Nunca se
  rellena con la parte del objetivo ni con un promedio (D13).
- `basis.tdee` (gasto de mantenimiento) alimenta el factor habitual de "comí distinto" (21, 17).

### 8. Transparencia

- Con `mostrar`, Ajustes explica cómo se calcula: "Gasto estimado: 1.764 kcal (basal 1.395 ×
  actividad 1,2 + rutina 90). Objetivo: 1.411 (−20 %)".
- Dice que es una estimación (±10 % entre personas) y que se afina con su peso (19, si se aprueba).
- Genera confianza del mismo modo que la tarjeta "Balance de hoy": la persona ve de dónde sale.

### 9. Cuándo se recalcula

Se deriva al leer. Lo que queda fijo son los **factores de ración** del plan (ticket 08), que se
recalculan por evento cuando el objetivo cambia más de un 5 % (peso, actividad, rutina, objetivo,
embarazo).

## Ejemplos para los tests (calculados a mano)

1. **Mujer, 35 años, 165 cm, 70 kg, `sentado`, rutina 3 × 45 min de gimnasio normal (MET 5,0),
   quiere perder.**
   - Basal = 700 + 1.031,25 − 175 − 161 = **1.395**.
   - Rutina = 3 × (4,0 × 70 × 0,75) / 7 = **90**.
   - TDEE = 1.395 × 1,2 + 90 = **1.764**.
   - −20 % = 1.411 (déficit 353 < 500), por encima del suelo 1.395 → **1.411 kcal**.
   - Proteína 1,6 × 70 = **112 g**.
   - Si la tabla MET cambia al implementar, se recalcula el ejemplo.
2. **Hombre, 40 años, 180 cm, 85 kg, `activity_level: "ligero"` antiguo, sin rutina, mantener.**
   - Basal = 850 + 1.125 − 200 + 5 = **1.780**.
   - PAL 1,375 → TDEE = **2.448 kcal**.
   - Proteína 1,2 × 85 = **102 g** · grasa **82 g** · fibra **34 g** · carbohidratos **326 g**.
3. **Suelo:** mujer, 60 años, 155 cm, 58 kg, `sentado`, perder → comprobar que no baja de su basal.
4. **IMC > 30:** 110 kg, 175 cm → peso de referencia 82,7 kg.
5. **Embarazo con objetivo de perder** → no hay déficit.
6. **Menor de 18** y **sin altura** → `null`.
7. **Normalización:** cada valor antiguo (`sedentario`, `ligero`, `activo ligero`, `moderado`,
   `activo`, `alto`, `muy activo`) → su PAL; `muy activo` nunca da 1,375.

## Criterios de aceptación

- [ ] Los 7 ejemplos como tests.
- [ ] Web y móvil: la barra de Hoy, el semáforo del calendario y el texto de la guía miden contra el
      mismo objetivo. El aviso "orientativo" se mantiene.
- [ ] Test del semáforo de un día pasado con `guide.targets` guardado.
- [ ] Con `ocultar`: se calcula, pero no aparece en ninguna parte.
- [ ] Extracción del onboarding: 5 transcripciones de prueba (a mano, con el modelo) → `daily_activity`
      y `training` esperados.
- [ ] Navegador (perfil demo): cambiar el peso, la actividad o la rutina en Ajustes cambia el
      objetivo y la explicación.
- [ ] Simulador iOS: Hoy muestra el mismo objetivo que la web.

## Comments

- 2026-09-24 — Reescrito tras la auditoría. Añade las entradas normalizadas y la rutina (D9), el
  semáforo, la retirada del texto de kcal que escribía el modelo, la copia del objetivo por día y la
  transparencia en Ajustes. El mapeo original (4 valores) dejaba sin cubrir `activo`, `muy activo` y
  `activo ligero`, que son los que guarda el onboarding.

- 2026-09-24 — Tras confirmar D7-D13: D9 confirmada. Fuera el respaldo con la parte del objetivo (D13); `tdee` alimenta el factor habitual (21).

- 2026-09-25 — **Hecho en código** (web y móvil): `src/lib/nutrition/energy.ts` y
  `exercise-energy.ts` (copias en `mobile/lib/`). Decisiones:
  - **Ejemplo 1:** con la regla del ticket (tope de proteína del 30 % de las kcal) salen
    **106 g**, no 112: el ejemplo no aplicaba el tope. El test sigue la regla.
  - Producción (consulta de solo lectura, 2026-09-25): `activity_level` ligero 30, activo 27,
    muy activo 22, **moderada 1** (vocabulario que no estaba en el ticket), sin dato 23. Todos
    cubiertos por `normalizeActivity`.
  - `training` se guarda como **texto corto** ("3 × 45 min · Gimnasio / pesas · Normal") y lo lee
    `parseTraining`, en vez de un jsonb: así se edita con el campo de texto de Ajustes y por chat
    sin UI nueva. `parseOnboarding` lo devuelve ya en forma canónica.
  - MET: valores del Compendio (2011/2024) redondeados en `EXERCISE_MET`; conviene revisarlos
    contra la tabla publicada.
  - Hoy mide contra el objetivo en vivo (el perfil) y mantiene al día la copia `guide.targets`;
    si el plan del mes (hecho antes del objetivo) suma < 85 % del objetivo, se dice debajo de la
    barra.
  - Migración `20260925130000_profiles_daily_activity_training.sql` **sin aplicar**: hasta
    entonces todo el mundo usa la normalización de `activity_level`.
  - **Pendiente:** el script de relleno offline de `daily_activity`/`training` (escribe en
    producción; no se ha hecho) y la verificación de las 5 transcripciones con el modelo.
