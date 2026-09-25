# 13 — Todo plato se calcula: fuera los promedios, proteína en la decisión y descomposición que no se rinde

Status: done (2026-09-25; pendiente la medición con `eval:recipes`)
Blocked by: —
Tamaño: M
Fase: 1

## Qué

1. **Ningún plato se enseña ni se suma con un promedio.** Se retira `roughMealMacros`. Un plato está
   **calculado** (sale de su receta) o **calculando** (se reintenta). No hay tercera opción.
2. La cadena de cálculo **no se rinde a la primera**: reintento por plato, segundo modelo, y
   pregunta a la persona si el texto no dice qué comió.
3. Un ingrediente que pesa en kcal **nunca cae en el genérico** de 130 kcal.
4. La **proteína** entra en la decisión de compensar.

## Por qué

- **D13 (usuario, 2026-09-24):** "siempre se calculen los platos, no vale poner un average de 600
  kcal y adiós".
- **H16:** si la descomposición falla, la comida cae a `roughMealMacros` (600 kcal la comida, 500 la
  cena), sin marca. Con esa cifra se mide el desvío de "comí distinto" y se decide si mover el plan.
- **H18:** en el eval, 24 de 225 pasadas volvieron sin descomponer, en lotes enteros y sin error
  registrado.
- **H17:** `settleDay` no pasa `deltaProtein` a `compensationNeed`, así que la regla aprobada
  (bajada de proteína ≥ 20 g → compensar) nunca se activa.
- **H22 (B2):** un plato con 30 g de manteca sin identificar sale con calidad 0,92 y un −37 % de
  kcal.

## Diseño

### 1. Dos estados, sin promedios

- `MealMacroEstimate.status: "calculado" | "calculando"`. Con `calculando` no lleva cifras. Una guía
  antigua sin campo cuenta como `calculado`.
- Se retira `roughMealMacros` y cualquier cifra por tipo de comida. El `fallback` de la guía queda
  solo para el texto (intro, hábitos, consejos).
- **Hoy:** la comida `calculando` enseña "Calculando…" en su fila, sin cifras. La barra suma solo lo
  calculado y dice "1 comida por calcular". El semáforo no juzga un día con comidas por calcular
  (gris) hasta que estén todas.
- **Reintento automático:** al abrir Hoy, al volver a la app y cada 2 minutos mientras esté abierta
  (como mucho 5 veces seguidas; después, al siguiente arranque). El detalle de un día pasado
  recalcula al abrirse.

### 2. La cadena de cálculo (`decomposeDishes`)

1. Lote con `DISH_MODEL`.
2. Los platos que vuelven vacíos se reintentan uno a uno, en paralelo, con el mismo modelo.
3. Los que sigan vacíos pasan por `DISH_FALLBACK_MODEL`, de otra familia (si `DISH_MODEL` es de
   OpenAI, `google/gemini-2.5-flash`, y al revés). El A/B del 05 comprueba que cumple los mismos
   objetivos.
4. Si todo falla (proveedor caído), el plato queda `calculando`, con el motivo registrado (JSON
   inválido, lote cortado, timeout, tope de gasto) y sin datos personales.

- **Tope de gasto:** la descomposición de un plato **no la corta el tope diario** (sí el mensual).
  Cuesta céntimos, con la caché global (06) casi siempre es gratis, y dejar un plato sin calcular
  rompe D13. Sigue sumando al gasto y contando en las cuotas por hora. Cambio explícito en
  `createAiProvider` (opción `capScope: "month"`), documentado junto a `AI_SPEND_CAPS` en CLAUDE.md.

### 3. Texto vago: se pregunta, no se inventa

- La descomposición devuelve `vago: true` cuando el texto no permite saber qué se comió ("algo
  rápido", "lo de siempre", "lo que había en la oficina").
- La hoja de "comí distinto" pide concretar con un ejemplo ("¿Qué comiste? Por ejemplo, «bocadillo
  de jamón»") y ofrece apuntar las kcal a mano (`manual`: la cifra es de la persona, no un promedio).
  Lo mismo en `setPlanMeal` desde Plan y en el chat (`cambiar_plato`).
- Si no es comida, como ahora (content-guard + `comida: false`).

### 4. Ingredientes: un genérico no puede pesar

- El esquema de la descomposición añade `categoria` a cada ingrediente (proteína, cereal, grasa…).
- Un ingrediente que no casa con la tabla y aporta **≥ 5 % de las kcal** del plato: una llamada
  barata (`google/gemini-2.5-flash-lite`) elige **el alimento más parecido** de una lista cerrada de
  candidatos de su categoría, **sin cifras** (el modelo elige un número de la lista). Es el paso de
  desambiguación del 04, adelantado.
- Los ingredientes que no casan y aportan < 5 % de las kcal (especias, un chorrito de algo) usan la
  mediana de su categoría.
- `GENERIC_FOOD` solo queda para algo sin categoría y sin peso energético (< 5 % de las kcal).
- El 22 sustituye el "más parecido" por la composición real de USDA.

### 5. Cambio de plato

- El desvío solo se calcula con las dos cifras `calculado`. Mientras el plato nuevo esté
  `calculando`, el cambio se queda en la cola del día (`day-settle.ts`, que ya persiste el pendiente)
  y se asienta cuando esté.
- Un `plannedKcal` que no estaba calculado se recalcula (con la receta del plato del plan) antes de
  medir.

### 6. Proteína en la decisión

- `perMealKcalDeltas` → `perMealDeltas`: devuelve `{ label, kcalDelta, proteinDelta }` (plato nuevo
  frente a `plannedIdea`). Web y móvil.
- `MealHabit.swapProteinDelta` junto a `swapKcalDelta`, con la misma contabilidad: pendiente y
  compensado, `swapCompensated` y signo contrario al deshacer.
- `dayBalance` suma la proteína pendiente de las comidas. El picoteo suma proteína positiva; el
  deporte, ninguna.
- `settleDay` pasa `deltaProtein` a `compensationNeed`.
- `dayNote` menciona la proteína cuando es lo que dispara. Hasta el 12, reponerla la pide el modelo;
  con el 12, el código.

## Archivos

- `src/lib/nutrition/resolve-dish.server.ts` (cadena, `categoria`, `vago`, desambiguación)
- `src/lib/ai-provider.server.ts` (`DISH_FALLBACK_MODEL`, `DISAMBIGUATION_MODEL`, `capScope`),
  `src/lib/rate-limit.server.ts`
- `src/lib/guide.functions.ts` (fuera `roughMealMacros`; estado por comida), `src/lib/macros.ts`
- `src/lib/use-meal-swap.ts`, `src/lib/day-settle.ts`, `src/lib/day-settle.functions.ts`,
  `src/lib/day-balance.ts`, `src/lib/plan-shared.ts` (`MealHabit`)
- Hoy, la barra de macros, la hoja de "comí distinto" y la tarjeta "Balance de hoy", en web y móvil
- Copias en `mobile/lib/`

## Criterios de aceptación

- [ ] `roughMealMacros` ya no existe; ningún camino devuelve cifras fijas por tipo de comida (test y
      grep).
- [ ] Test: un plato que falla con el primer modelo y sale con el segundo queda `calculado`.
- [ ] Test: si fallan los dos, queda `calculando`, no suma y no genera desvío.
- [ ] Test: la manteca de cerdo de la auditoría deja de valer 130 kcal/100 g (casa con una grasa).
- [ ] Test: el cambio de lentejas (18 g de P) a pasta con tomate (−22 g de P, +40 kcal) compensa por
      proteína con cualquier objetivo.
- [ ] `bun run eval:recipes`: pasadas sin descomponer ≤ 1 % (antes 10,7 %).
- [ ] Navegador (perfil demo): "comí algo rápido" → pide concretar. Un fallo simulado del modelo →
      "Calculando…" y se calcula al reintentar.
- [ ] Simulador iOS: mismos casos.

## Comments

- 2026-09-24 — Reescrito tras D13. La versión anterior dejaba un respaldo "marcado" (y el 07 lo
  rellenaba con la parte del objetivo). El usuario no acepta ningún promedio: un plato se calcula o
  se está calculando.

- 2026-09-25 — **Hecho** (web y móvil). Decisiones tomadas al implementar:
  - "Calculado" = el plato tiene receta (`isCalculated` en `resolve-dish.server.ts`), sin el
    umbral de calidad 0,4: con la resolución por categoría y el alimento más parecido ningún
    ingrediente que pesa queda en el genérico, y caer a un promedio por calidad baja es lo que
    D13 prohíbe. El umbral por kcal lo fija el 14 con el eval.
  - La cadena vive en `decompose-chain.ts` (puro, con `ask` inyectado) para poder testearla sin
    red. Presupuesto de tiempo: lote 120 s, uno a uno 60 s, respaldo 45 s. Para que quepa, el
    `maxDuration` de Vercel sube de 60 a 300 s (Fluid Compute activado, memoria `infra-deploy`).
  - Reintento barato: `generateDailyGuide` acepta `reuse` (lo ya calculado no se vuelve a
    descomponer), `macrosOnly` (sin texto) y `extraDishes` (el plato del plan cuando su cifra no
    estaba congelada). Un cambio de plato que sigue `calculando` vuelve a la cola del día
    (`ResolvedDishes.unresolved`).
  - Texto vago: lo detecta `resolveDish` en `setPlanMeal` (misma llamada que ya decidía "¿es
    comida?"), así que cubre Hoy, Plan y el chat sin llamadas nuevas. Se salta al deshacer y con
    `manual: true`.
  - Si solo la proteína dispara la compensación y el modelo no mueve nada, `settleDay` devuelve
    la reserva sin lanzar, para no reintentar cada minuto.
  - Tests: `decompose-chain.test.ts`, `nutrition.test.ts` (manteca → grasa), `macros.test.ts`
    (calculando no suma ni genera desvío, `reuse`, `mergeGuide` por comida, semáforo gris) y
    `day-balance.test.ts` (lentejas → pasta con tomate compensa por proteína con cualquier
    objetivo).
  - Pendiente: `bun run eval:recipes` para medir las pasadas sin descomponer (antes 10,7 %); gasta
    llamadas a `openai/gpt-5` y se deja para cuando se decida lanzarlo.
