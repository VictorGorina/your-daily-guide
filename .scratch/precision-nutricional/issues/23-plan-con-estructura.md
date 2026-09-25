# 23 — Plan con objetivo: kcal por comida y estructura de la comida en el prompt

Status: implementado el prompt (2026-09-25); el eval NO cumple, ver Comments
Blocked by: 07, 21
Tamaño: M
Fase: 2
Se despliega junto con: 14 y 21
Viene de: la parte de prompt del ticket 10 (el 10 se queda la comprobación en código)

## Qué

El generador del plan mensual sabe qué objetivo tiene cada comida y **compone las comidas como se
come en España**: plato principal, acompañamiento y postre. Hoy propone un solo plato por comida.

## Por qué

- H1: el prompt del plan no lleva ninguna cifra.
- H24: con la ración de AESAN, un solo plato no llena una comida. Los 4 platos del golden set suman
  ≈ 960 kcal a la persona de referencia (2.000 kcal). Con la ración personal (21), Hoy lo enseñaría.
- Como la ración de cada plato y el objetivo escalan con la misma persona, **la estructura de la
  comida vale para todos**. Lo que cambia entre una mujer de 1.300 kcal y un hombre de 3.400 es el
  tamaño de cada componente (21), no cuántos hay.

## Diseño

### Prompt (`generatePlanBody`, y el de `reflowMeals` / `adjustMonthlyPlan` cuando proponen platos)

- **Kcal y proteína por comida** del 07 (desayuno ~430, comida ~600…). Son informativas: las
  cantidades las pone el código.
  - En un hogar, para las comidas compartidas, la media de los adultos, sin nombres ni cifras
    individuales.
  - Con `ocultar`, se calculan igual: la preferencia no cambia el plan.
- **Estructura de cada comida:**
  - Comida y cena: plato principal + acompañamiento (pan, guarnición o ensalada) + postre (fruta o
    lácteo). Si la comida pide mucho (objetivo alto), primer y segundo plato.
  - Desayuno y merienda: 2-3 componentes (lácteo + cereal o pan + fruta, o equivalentes).
  - Cada componente sigue siendo concreto (memoria `plan-no-generic-eating-out`).
- **Según el objetivo:**
  - Perder: platos de volumen (verdura + proteína magra) y cenas ligeras dentro de su parte.
  - Ganar: meriendas contundentes y cereal o legumbre en las dos comidas principales.
  - Proteína ≥ 1,6 g/kg: una fuente de proteína clara en comida y cena.
- **Formato:** cada comida sigue siendo un texto (`lunch` / `dinner` / ideas de desayuno y
  merienda), con los componentes separados por " · ". Por ejemplo, "Lentejas estofadas con verduras
  · pan integral · naranja".
  - La descomposición (05) ya entiende un plato compuesto.
  - La receta (09) es la del plato principal.
  - Hoy enseña la línea entera.
  - Los componentes entran en la compra: mientras no exista el 11, el modelo los añade a
    `weekQty`, como ahora.
- **Salida por schema** (`generateObject` + Zod) en vez de `askForJson` con 3 reintentos. El JSON
  del plan es largo: medir latencia y tokens de salida antes de retirar el camino actual.

### Medida (sin `planFit` todavía)

Script `bun run eval:plan-lite`. Genera el plan para las tipologías del spec y suma cada día con la
ración personal (21) frente al objetivo (07). **Objetivo provisional: ≥ 70 % de los días a ±15 %.**
El 10 lo lleva a ±5 % con la comprobación y la corrección en código.

## Archivos

- `src/lib/plan.functions.ts` (`generatePlanBody`, prompts de recolocación)
- `src/lib/plan-shared.ts` (lectura de comidas con varios componentes, si hace falta)
- `src/lib/plan-eval/plan-lite.ts` + `package.json`

## Criterios de aceptación

- [ ] `eval:plan-lite` cumple el objetivo provisional en las tipologías de una sola persona.
- [ ] Ningún plan nuevo propone una comida principal de un solo componente (comprobado en el eval).
- [ ] La compra incluye pan, fruta y lácteos de los postres.
- [ ] Navegador (perfil demo): generar el plan (gasta cuota de IA) → las comidas llevan su estructura
      y la barra de Hoy ronda el objetivo.
- [ ] Simulador iOS: las comidas con componentes se leen bien.

## Comments

- 2026-09-25 — **Implementado**: `planTargetsPrompt` (objetivo por comida, media del hogar,
  estructura " · ", sesgo por objetivo), `targetsVersion` en el plan, aviso en Hoy solo para planes
  anteriores, `bun run eval:plan-lite`. Se mantiene `askForJson` (no se ha medido aún la salida
  estructurada del plan largo). **Resultado de `eval:plan-lite`: ver abajo.**

- 2026-09-25 — **`eval:plan-lite` (7 días × 3 tipologías, GPT-5 para las recetas, PLAN_MODEL para
  el plan): NO cumple.** Días a ±15 % del objetivo: **5/21 (24 %)**, frente al ≥ 70 % provisional.
  Comidas principales de un solo componente: **8/42** (objetivo 0). Sesgo a la baja en las tres:
  mujer que pierde (1.330 kcal) −25 % a −67 %, 0/7; hombre que mantiene (2.431) −5 % a −41 %, 1/7;
  hombre que gana (3.421) −40 % a +2 %, 4/7. Sin escalar, un día de raciones AESAN con la estructura
  que devuelve el modelo ronda 1.100 kcal para la persona de referencia, no 2.000: la estructura en
  el prompt no cierra el día. Apareció además un "Comida social o tu plato preferido" genérico
  (memoria `plan-no-generic-eating-out`). Lo que lo cerraría es la comprobación y corrección en
  código del día (10, `planFit`) y el escalado por grupos (08), de la fase 3. Decisión pendiente del
  usuario: ver el resumen de la sesión.
