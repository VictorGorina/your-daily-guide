# 07 — Objetivo energético personal (en código)

Status: ready (D2 aprobada)
Blocked by: 01
Tamaño: M

## Qué

`energyTargets(profile)` calcula en código las kcal y macros diarias de cada persona y su reparto
por comida. La barra de Hoy mide contra ese objetivo y la línea de "calorías del día" sale de aquí,
no del modelo. Lo que se enseña depende de `nutrition_numbers` (ticket 01).

## Por qué

Hallazgo H1. Sin objetivo, "la cantidad correcta" no existe: solo hay una ración estándar.

## Diseño — `src/lib/nutrition/energy.ts` (puro)

### Gasto

- **Metabolismo basal (Mifflin-St Jeor):** `10·kg + 6,25·cm − 5·edad + s`, con `s = +5` hombre,
  `−161` mujer y `−78` (la media) para "otro" o sin dato.
- **Edad:** `ageFromDOB` ([src/lib/age.ts](../../../src/lib/age.ts)).
- **Peso:** `current_weight_kg` (lo actualiza la herramienta `actualizar_peso` del chat).
- **Actividad (PAL):** sedentario 1,2 · ligero 1,375 · moderado 1,55 · alto 1,725. Sin dato →
  1,375.
- `TDEE = basal × PAL`.

### Ajuste por objetivo (dirección con `deriveGoalType` de `src/lib/daily.ts`)

| Caso | kcal |
|---|---|
| perder | `TDEE × 0,80`, sin bajar más de 500 kcal, con suelo `max(basal, 1200 mujer / 1500 hombre / 1350 otro)` |
| ganar | `TDEE × 1,10`, sin subir más de 300 kcal |
| mantener o sin objetivo | `TDEE` |
| embarazo | nunca déficit; `TDEE + 300` (no sabemos el trimestre) |
| lactancia | nunca déficit; `TDEE + 400` |
| menor de 18 | `null`: la fórmula no está validada; se usa la ración base |
| faltan altura, peso o edad | `null` → comportamiento actual |

Una fecha objetivo que pida más ritmo **no** cambia estos topes (misma regla que el prompt del
coach: se ajusta la fecha, no el hambre).

### Macros

- **Peso de referencia para la proteína:** si IMC > 30, el peso con IMC 27 (`27 × altura²`); si no,
  el peso actual.
- **Proteína:** 1,2 g/kg de referencia; 1,6 g/kg si pierde peso o entrena fuerza
  (`strength_training_experience` distinta de "ninguna"). Tope: 2,0 g/kg y 30 % de las kcal.
- **Grasa:** 30 % de las kcal (mínimo 25 %).
- **Fibra:** 14 g por cada 1.000 kcal.
- **Carbohidratos:** lo que queda.

### Reparto por comida

Pesos base: desayuno 0,25 · comida 0,35 · cena 0,28 · merienda 0,12. Se renormalizan sobre
`effectiveMealSlots(profile)`. Una comida fuera de casa conserva su parte del objetivo, pero su plato
no se escala (restaurante).

### Salida

```ts
type EnergyTargets = {
  kcal: number; protein_g: number; fat_g: number; carbs_g: number; fiber_g: number;
  perSlot: Record<MealSlot, { kcal: number; protein_g: number }>;
  basis: { bmr: number; tdee: number; pal: number; adjustment: number; refWeightKg: number };
} | null;
```

Se deriva al leer. Lo que queda fijo son los **factores de ración** del plan (ticket 08), que se
recalculan por evento cuando el objetivo cambia más de un 5 %.

### Ejemplos para los tests (calculados a mano)

1. **Mujer, 35 años, 165 cm, 70 kg, moderado, quiere perder.** Basal = 700 + 1.031,25 − 175 − 161
   = **1.395**. TDEE = 1.395 × 1,55 = **2.163**. −20 % = −433 (< 500) → **1.730 kcal**. Proteína
   1,6 × 70 = **112 g** (26 %). Grasa 30 % → **58 g**. Fibra **24 g**. Carbohidratos
   (1.730 − 448 − 519) / 4 = **191 g**. Por comida con los 4 slots: desayuno ~433, comida ~606,
   cena ~484, merienda ~208.
2. **Hombre, 40 años, 180 cm, 85 kg, ligero, mantener.** Basal = 850 + 1.125 − 200 + 5 = **1.780**.
   TDEE = **2.448 kcal**. Proteína 1,2 × 85 = **102 g**. Grasa **82 g**. Fibra **34 g**.
   Carbohidratos **326 g**.
3. **Suelo:** mujer, 60 años, 155 cm, 58 kg, sedentaria, perder → comprobar que no baja de su basal.
4. **IMC > 30:** 110 kg, 175 cm → peso de referencia 82,7 kg.
5. **Embarazo con objetivo de perder** → no hay déficit.
6. **Menor de 18** y **sin altura** → `null`.

## Consumo en este ticket

- `generateDailyGuide`: la respuesta añade `targets?: EnergyTargets` (opcional; el móvil antiguo lo
  ignora). `calories` (texto) se construye en código: "entre X y Y kcal" (objetivo ±7 %, redondeado a
  50). Con `ocultar`, texto sin cifras. El modelo deja de escribir esa cifra.
- `MacroBars` (web y móvil): `target` = `targets` cuando existe; si no, lo de ahora. Con `ocultar`,
  no se pinta (ticket 01).
- `coachSystemPrompt`: con `mostrar`, línea "Objetivo orientativo: ~1.730 kcal y 112 g de proteína
  al día" para que el chat no contradiga a la app. Con `ocultar`, no se añade.

## Criterios de aceptación

- [ ] Los 6 ejemplos como tests.
- [ ] Web y móvil: la barra de Hoy mide contra el objetivo. El aviso "orientativo" se mantiene.
- [ ] Con `ocultar`: se calcula, pero no aparece en ninguna parte.
- [ ] Navegador (perfil demo): cambiar peso o actividad en Ajustes cambia el objetivo.
- [ ] Simulador iOS: Hoy muestra el mismo objetivo que la web.

## Comments
