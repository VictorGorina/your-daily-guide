# Spec — Precisión nutricional y plan personalizado

Status: **replanificado el 2026-09-24** tras la auditoría
([auditoria-2026-09-24.md](auditoria-2026-09-24.md)). D1-D13 cerradas (D1-D6 el 2026-09-15; D7-D13
confirmadas por el usuario el 2026-09-24). Fase 1 (2026-09-25): 13, 01 y 07 hechos en código
(01 y 07 esperan sus migraciones); el 14 se aplaza para desplegarse con el 21 y el 23.
Feature slug: `precision-nutricional`
Sucede a: `.scratch/nutricion-determinista/` (sus Fases 0-2 están hechas; las Fases 3-5 quedan
absorbidas aquí, en los tickets 10-12).

## En una frase

Cada persona tiene un **objetivo de energía y proteína calculado en código** a partir de su
onboarding. Cada plato sale de una **receta canónica en gramos crudos**, validada en código y
guardada una sola vez para todo el mundo, que **el código escala a ese objetivo**. Y esos mismos
gramos son la receta que se cocina, las cifras de Hoy y la lista de la compra. El modelo elige los
platos y propone su composición; nunca decide la cantidad ni escribe una cifra.

## Para qué sirven las cifras

La app es una guía realista, no un contador clínico (usuario, 2026-09-24). No hace falta que sea
exacta, pero tienen que cumplirse **las tres cosas a la vez**:

1. **Cocinable:** los platos de cada día se pueden cocinar con lo comprado en el súper.
2. **Personal:** cada tipo de usuario tiene un plato con el tamaño y la composición que le tocan
   según su onboarding y su objetivo.
3. **Bastante preciso:** kcal y macros fiables, tanto en los platos sugeridos como en los que la
   persona cambia durante el día.

Un cambio que mejora la cifra pero rompe una de las otras dos no es una mejora.

## El estándar: platos perfectamente calculados

Requisito del usuario: los platos tienen que estar **perfectamente calculados**. En la práctica,
eso significa que se cumplen estas siete cosas a la vez:

1. **Trazable:** cada cifra se reconstruye desde la receta guardada (ingredientes, gramos crudos,
   método) y desde una fila de `foods` con su `source` y su `sourceId`.
2. **Validado:** pasa todas las reglas de `validateRecipe` (omisiones, rangos, grasa de cocinar por
   método, masa y banda de kcal).
3. **Contrastado cuando el eval lo pide:** si una sola lectura validada no alcanza los objetivos,
   entran fuentes independientes (ticket 20). Mientras no haga falta, las recetas más usadas las
   revisa una persona.
4. **Medido:** el golden set demuestra el error (objetivos de la tabla de abajo) y se vuelve a medir
   con cada cambio del pipeline.
5. **Revisado:** los platos más usados los revisa una persona a mano (`reviewed`).
6. **Personal:** la cantidad sale del objetivo de cada persona, no de una ración igual para todos.
7. **Siempre calculado:** todo plato sale de su receta. No hay promedios por tipo de comida;
   mientras un plato no se ha podido calcular, se dice ("Calculando…") y se reintenta (D13).

Lo único que queda fuera del sistema es la variación del alimento real y lo que cada uno se sirve
(±10-20 %). El aviso "estimación orientativa" se refiere solo a eso.

## Qué significa "personalizado"

Cinco capas, todas calculadas en código a partir del perfil:

| Capa | Qué decide | De qué datos | Ticket |
|---|---|---|---|
| 1. Energía | kcal del día | sexo, edad, altura, peso, actividad del día a día, rutina de entrenamiento, objetivo, embarazo | 07 |
| 2. Macros | proteína (g/kg), grasa, fibra y carbohidratos | objetivo, entrenamiento de fuerza, peso de referencia | 07 |
| 3. Estructura y tamaño | factor de ración personal; estructura de cada comida (plato · acompañamiento · postre); gramos | objetivo y gasto de mantenimiento, comidas que planifica, hogar | 21, 23, 08, 10 |
| 4. Necesidades especiales | reglas más prudentes | condiciones médicas, medicación, patrón de dieta, edad | 15 |
| 5. Preferencias | qué platos | dieta, alergias, lo que no le gusta, cocina favorita, utensilios, presupuesto, horarios | ya existe (prompt) |

Tipologías de referencia. Son también los perfiles del eval del ticket 10:

| Perfil | Energía | Proteína | Qué cambia en el plan |
|---|---|---|---|
| Mujer, 32 años, sedentaria, quiere perder | ~1.310 (suelo en su basal) | 1,6 g/kg | raciones ×0,66; platos de volumen (verdura + proteína magra) |
| Hombre, 40 años, actividad ligera, mantener | ~2.450 | 1,2 g/kg | raciones ×1,22 |
| Hombre, 24 años, entrena 5 días, quiere ganar | ~3.440 | 1,6-2,0 g/kg | raciones ×1,7 (tope); primer y segundo plato cuando la comida lo pide; merienda contundente; su rutina ya va en el objetivo |
| Embarazada | gasto + 300, nunca déficit | ≥ 1,2 g/kg | seguridad alimentaria (ya en el prompt); nunca se compensa a la baja |
| Vegana | según objetivo | alcanzable con legumbre y soja | `planFit` comprueba la proteína del día |
| Diabetes tipo 2 | según objetivo | normal | carbohidratos repartidos de forma estable; nunca se compensa vaciando una comida |
| Enfermedad renal | según objetivo | tope de 0,8 g/kg | sin la regla de 1,6 g/kg; recomendación de consultar a un profesional |
| Hogar de 2 adultos (1.700 + 2.500) | cada uno el suyo | cada uno la suya | misma ración compartida; cada adulto cierra su día con sus comidas propias (D4) |
| Menor de 18 o sin datos | `null` | — | ración por sexo (hombre ×1,25, mujer ×1,0) |

Lo que se come **fuera del plan** también es personal (D10). "Un plato de pasta" son ~48 g de pasta
seca para una mujer pequeña con trabajo sentado, y ~108 g para un hombre corpulento con trabajo
físico. La cantidad es la ración de referencia del plato × su gasto de mantenimiento ÷ 2.000 kcal
(tickets 21 y 17).

## Fuentes de error y dónde se atacan

| # | Fuente de error | Tamaño típico | Ticket |
|---|---|---|---|
| 1 | Ración igual para todo el mundo, sin objetivo personal | ±30-60 % frente a lo que necesita cada persona | 07, 08, 10 |
| 2 | Valores crudos y cocinados mezclados | ±20-40 % en carne, pescado, cereal y legumbre | 14 (urgente), 05, 03 |
| 3 | Grasa de cocinar mal estimada | ±50-150 kcal por plato | 14, 05 |
| 4 | Ingrediente casado con el alimento equivocado | puntual, hasta ±70 % | 14 (urgente), 03, 04 |
| 5 | Ingrediente omitido o gramos de memoria del modelo | ±10-30 % | 05; 20 si el eval lo pide |
| 6 | El mismo plato da cifras distintas según el día | CV medido del 3,9 % | 06 |
| 7 | La compra se recorta en cantidad para cuadrar el presupuesto | lo que haga falta | 11 |
| 8 | Valor de la tabla frente al alimento medio | ±5-10 % (genéricos); ±25-50 % (productos españoles) | 14, 03 |
| 9 | El alimento real y lo que se sirve cada uno | ±10-20 % | irreducible; 17 reduce la parte de "cuánto comí" |
| 10 | Objetivo mal estimado (fórmula, actividad mal clasificada) | ±10 % (fórmula) + hasta −20 % (vocabulario) | 07, 19 |
| 11 | Deporte mal estimado o contado dos veces | ×0,5-×2 según el peso | 16 |
| 12 | Platos con un promedio por tipo de comida (600/500 kcal) en vez de calculados | cientos de kcal | 13 |
| 13 | Compensación sin medir | lo que haga falta | 18 (puente), 12 |
| 14 | La cantidad de "comí distinto", igual para todos | ×0,7-×1,7 según la persona | 21, 17 |
| 15 | Un solo plato por comida a ración de referencia: el día se queda corto | ≈ −50 % del objetivo | 23, 10 |

## Criterios de éxito (medibles)

| Métrica | Línea base (provisional, 2026-09-24) | Objetivo |
|---|---|---|
| kcal por ración base frente a la referencia (golden set) | 23,2 % medio / 44,5 % P90 | ≤ 6 % / ≤ 12 % |
| Sesgo de kcal con signo | +21,5 % | entre −3 % y +3 % |
| kcal por 100 g de plato (densidad) | 5,2 % | ≤ 6 % |
| Reparto de macros (% de kcal de P/C/G) | 5,3 pts | ≤ 3 pts |
| Proteína por ración | 23,3 % | ≤ 8 % |
| Ingredientes principales omitidos | 9,2 % | ≤ 1 % |
| Mismo plato → mismas cifras | CV del 3,9 % | 100 % idénticas |
| Pasadas sin descomponer | 24 de 225 (10,7 %) | ≤ 1 % |
| Casado a la fila correcta (referencias externas) | 64,7 % | ≥ 98 % |
| kcal/100 g de la tabla frente a referencias externas | 25,3 % | ≤ 8 % |
| Día planificado frente al objetivo de cada adulto (tipologías) | no existe objetivo | ±5 % en ≥ 90 % de los días |
| Proteína del día frente al objetivo | — | ≥ 90 % |
| La receta visible, la barra de Hoy y la compra usan los mismos gramos | no (tres fuentes) | sí |
| Un solo objetivo visible en toda la app | no (dos cifras en Hoy) | sí |
| Platos enseñados o sumados con un promedio en vez de su receta | 600/500 kcal fijas al fallar | 0 |
| Platos del plan sin calcular al llegar a Hoy | se calculan al verlos | 0 (se calculan al generar el plan) |
| "Comí distinto": la cantidad depende de la persona | no | sí (test) |
| Reajuste: kcal absorbidas ÷ kcal a compensar | sin medir | 80-120 %, o residuo explicado |
| Deporte: depende del peso y es neto | no | sí (test) |

Con D7, la métrica que decide la exactitud de un plato **planificado** es la densidad (más las
omisiones y el reparto de macros): su tamaño lo pone el código. La de "kcal por ración base" sigue
importando para "comí distinto" con unidad natural (ticket 17) y como medida del modelo.

## Diagnóstico del estado actual

### H1-H12 (2026-09-15)

Comprobado leyendo el código y probando `matchFood` con un script (sin llamadas al modelo).

- **H1 — No hay objetivo energético.** `macroTargets` ([src/lib/macros.ts](../../src/lib/macros.ts))
  es una referencia genérica. El "objetivo" de la barra de Hoy es la **suma de lo planificado**.
  `generatePlanBody` no recibe ninguna cifra de kcal y pide "Sin gramajes rígidos en los platos"
  ([src/lib/plan.functions.ts](../../src/lib/plan.functions.ts)). El perfil ya tiene `sex`,
  `date_of_birth`, `height_cm`, `current_weight_kg`, `activity_level`, `target_weight_kg` y
  `pregnancy_status`.
- **H2 — La ración es igual para todo el mundo.** `decomposeDishes(…, { servings: 1 })` con
  `RATION_ANCHORS` fijas ([resolve-dish.server.ts](../../src/lib/nutrition/resolve-dish.server.ts)).
- **H3 — La tabla mezcla crudo y cocinado.** Pechuga de pollo 165 kcal / 31 g P es el valor
  **asado** (cruda ≈ 120 / 22,5). Salmón 208 es **crudo**. Bacalao 105 es **cocinado** (crudo ≈ 82).
  `matchFood("pechuga de pollo cruda")` devuelve la fila asada con confianza alta.
- **H4 — Hay alias que agrupan alimentos distintos.** Resultados reales de `matchFood`:
  `salmorejo` → gazpacho, 35 kcal (real ≈ 110-150) · `morcilla`, `salchicha` → chorizo, 350 ·
  `crema de calabacin` → calabacín, 17 · `tortilla de patatas` → patata, 87 (real ≈ 190) ·
  `arroz con leche` → arroz blanco · `bacon`, `pavo loncheado` → genérico, 130. El alias `"mató"`
  lleva tilde y no está normalizado.
- **H5 — El eval mide confianza, no exactitud.** 100 % de "calidad" con los errores de H3 y H4
  dentro; con rangos de 200-450 kcal no se detecta un error del 40 %.
- **H6 — El resultado no es determinista.** El memo vive solo en el proceso y cada día se vuelve a
  preguntar al modelo.
- **H7 — Hay un único respaldo genérico de 130 kcal**, sin medias por categoría ni unidades.
- **H8 — El umbral de uso es `quality >= 0.4`** y la calidad se pondera por gramos, no por kcal.
- **H9 — Tres fuentes de gramos que no se hablan:** la descomposición de Hoy, `dishRecipe` y el
  `weekQty` que inventa el plan.
- **H10 — Nadie puede elegir no ver cifras.** La barra de kcal y macros se pinta para todo el mundo
  (web `hoy.tsx`, `day-detail-sheet.tsx`; móvil `hoy.tsx`). El único control es una regla de texto en
  el prompt del coach atada a `ed_history`.
- **H11 — La compra se recorta en cantidad.** `scaleShoppingToBudget` baja `weekQty` en proporción
  cuando el recorte por IA no basta.
- **H12 — La tabla es pequeña:** 167 filas.

Estado a 2026-09-24: H2 se midió (sesgo de +21,5 %). H3 y H4 están atacados en parte (`17a00d4`
aplicó `cookedYield`; salmorejo y embutidos tienen fila propia). El resto sigue abierto.

### H13-H25 (auditoría del 2026-09-24)

Detalle y evidencia en [auditoria-2026-09-24.md](auditoria-2026-09-24.md).

- **H13 — Dos objetivos en la misma pantalla.** El texto `guide.calories` lo escribe el modelo de
  chat (`hoy.tsx:825`, móvil `hoy.tsx:751`) y convive con la barra, que mide contra la suma del
  plan.
- **H14 — El semáforo del calendario mide contra la suma del plan** (`daySignalOf`). Si alguien come
  exactamente el plan, sale verde aunque el plan esté un 58 % por debajo de lo que necesita.
- **H15 — `activity_level` tiene cuatro vocabularios**: Ajustes, extracción del onboarding, valor por
  defecto y perfil demo. Además mezcla el día a día con el deporte en una sola frase. Con el mapeo
  del 07 original, "muy activo" caería en 1,375 (−20 % de gasto).
- **H16 — El respaldo no lleva marca.** `roughMealMacros` (600/500 kcal) entra en el desvío de "comí
  distinto" como si fuera una cifra calculada.
- **H17 — La regla de proteína no se aplica.** `settleDay` no pasa `deltaProtein` a
  `compensationNeed` (`day-settle.functions.ts:295`).
- **H18 — La descomposición falla en silencio**: lotes enteros sin descomponer y sin error
  registrado (24 de 225 pasadas en el eval).
- **H19 — La compensación no se verifica.** Basta con que cambie un plato
  (`day-settle.functions.ts:428`), y "raciones algo menores" no se puede expresar en el plan.
- **H20 — Deporte sin peso corporal y en bruto** (`estimateExerciseKcal`). En cuanto exista un
  objetivo con factor de actividad, la rutina se contaría dos veces.
- **H21 — "Comí distinto" no conoce la cantidad** ni las unidades naturales (una pizza, un
  bocadillo).
- **H22 — Casados erróneos nuevos:**
  - `tortilla francesa` → `wrap`.
  - `granola`, `muesli`, `cereales de desayuno`, `bacon`, `panceta`, `sobrasada`, `chistorra` →
    genérico.
  - `leche condensada` → leche entera.
  - `harina de garbanzo` → garbanzo cocido.

  Además, la calidad por gramos da 0,92 a un plato con un error del −37 % (30 g de manteca).
- **H23 — Salmón:** una fila cruda con `cookedYield`. Cuando el modelo marca `wasRaw`, se cuenta un
  20 % de menos.
- **H24 — La ración de AESAN no es "tu" ración.** Cuatro platos a AESAN suman 959 kcal. La exactitud
  por ración solo tiene sentido frente al objetivo; tras escalar, el error es el de densidad (base
  de D7).
- **H25 — Las necesidades especiales no cambian el cálculo.** Enfermedad renal, diabetes y dieta
  vegana solo existen como texto en el prompt.

**Incoherencias del propio plan, corregidas en esta versión:**

- El ticket 05 fijaba una `BASE_RATION` (140 g de carne, 2 huevos, 75 g de pasta) que contradecía la
  decisión del 2026-09-24 del punto medio de AESAN.
- El 05 solo añadía aceite "si falta", cuando el problema medido es que el modelo pone de más.
- El 12 estaba escrito contra la arquitectura anterior a `balance-del-dia` (`reflowMeals` y
  `FORCE_ADJUST_KCAL`, y no el asentamiento único de `settleDay`).
- El 08 citaba `kcalDeltaOf`, que ya no existe.
- El 07 no normalizaba las entradas ni tocaba el semáforo.

## Decisiones

### Cerradas (2026-09-15)

- **D1 — Gramos por persona visibles en la receta: sí.** La tarjeta del plan sigue sin gramos.
- **D2 — Objetivo calculado en código y plan dimensionado a él: sí.** La barra de Hoy mide contra
  el objetivo.
- **D3 — Ver cifras es una preferencia explícita**, no algo que la app deduzca de otros datos. Se
  pregunta en el onboarding, toda la app la respeta y se cambia cuando se quiera en Ajustes, que lo
  dice claramente. Con "no": ni kcal, ni macros, ni objetivos, ni porcentajes en ninguna pantalla,
  ni en el texto del coach ni en las notificaciones. Los platos se siguen calculando y escalando
  igual, y las recetas mantienen sus cantidades (hacen falta para cocinar la ración correcta).
  `ed_history` deja de controlar las cifras. Ver ticket 01.
- **D4 — Hogar: la ración de las comidas compartidas es la misma para todos los adultos** y tiene
  que ser compatible con el objetivo de cada uno. Si una comida compartida saca a un adulto de su
  plan, se corrigen **sus comidas no compartidas** (desayuno, merienda y las que no comparte) para
  volver a su objetivo: primero ajustando raciones y, si no basta, cambiando el plato. Los niños
  siguen con su ración manual. Ver tickets 08, 10, 11 y 12.
- **D5 — Valores de la tabla: USDA FoodData Central + CIQUAL.** BEDCA solo como contraste.
- **D6 — Llamada adicional a una IA barata: sí.** Está permitida, no es obligatoria: la combinación
  la decide el eval (ver D7 y el ticket 20).
- **Ración base = punto medio de AESAN 2022** (2026-09-24, ticket 02): legumbre seca 60 g, arroz o
  pasta seca 70 g, carne cruda 110 g, pescado crudo 135 g, fruta 150 g, frutos secos 25 g, pan 50 g,
  yogur 125 g, leche 200 ml, 1 huevo M ≈ 50 g comestible, aceite 10 g. Si el modelo da raciones por
  encima, se trata como error del sistema.

### Confirmadas por el usuario el 2026-09-24

- **D7 — La cantidad la decide el código antes de buscar más fuentes (orden por fases).** El eval
  demuestra que el modelo acierta la composición (densidad 5,2 %) y falla la cantidad. Con el
  escalado al objetivo (08), la cantidad del modelo deja de importar para los platos planificados.
  Por eso el orden pasa a ser: objetivo (07) → receta canónica con **una** lectura validada (05) →
  caché (06) → escalado (08). Las fuentes independientes (Sonar y juez) salen del 05 al ticket 20,
  que solo se hace si el eval lo pide después del escalado. Es "la variante más barata que cumpla
  los objetivos", como ya decía el spec.
- **D8 — Gramos crudos en la receta canónica** (se mantiene el invariante 3 aprobado). La receta que
  se pesa y la compra van en crudo. `cookedYield` queda solo para entender lo que alguien escribe
  "tal como se come" ("130 g de pollo a la plancha").
- **D9 — Deporte: la rutina habitual va dentro del objetivo.** El gasto diario suma la rutina que la
  persona declara (sesiones por semana). "Registrar deporte" solo compensa lo que pasa de esa rutina
  en la semana: la 4.ª sesión de alguien que entrena 3, o una sesión el doble de larga de lo
  habitual. Si alguien no registra nada, su objetivo no se queda corto. Alternativa descartada: un
  objetivo sin deporte y todo sumado al registrarlo (obliga a registrar siempre y hace que el
  objetivo baile cada día).
- **D10 — "Comí distinto": aproximado, pero proporcional a cada persona** (propuesta del usuario).
  Nadie pesa lo que come fuera del plan, pero un hombre corpulento que come mucho y una mujer pequeña
  que dicen "un plato de pasta" no han comido lo mismo. La cantidad sale, por este orden:
  1. de lo que diga el texto ("media pizza", "dos platos");
  2. de la unidad natural del plato (pizza, bocadillo, hamburguesa: sin escalar);
  3. de la ración de referencia del plato × el **factor habitual** de la persona (gasto de
     mantenimiento ÷ 2.000 kcal, entre 0,6 y 1,7; sin datos, por sexo).

  Encima, chips pequeño / normal / grande, que aprenden el tamaño de cada uno. Sustituye a la
  versión anterior ("la misma masa que el plato planificado"), que fallaba al cambiar una ensalada
  por pasta. Tickets 21 y 17.
- **D11 — Necesidades especiales como marcas derivadas, sin preguntas nuevas.** Salen del texto que
  la persona ya da (condiciones médicas, medicación, dieta, edad). Solo hacen las reglas **más
  prudentes** y siempre van con la recomendación de consultar a un profesional. Las reglas las
  revisa alguien con formación en nutrición antes de activarlas.
- **D12 — Calibración del gasto con la tendencia de peso: opcional, fase 4.** La fórmula se equivoca
  ±10 % entre personas; con pesajes suficientes, el gasto estimado se corrige en pasos de ≤ 5 % y
  como mucho ±10 %.
- **D13 — Todo plato se calcula** (usuario: "no vale poner un average de 600 kcal y adiós"). Fuera
  `roughMealMacros` y cualquier promedio por tipo de comida. Un plato está calculado desde su receta
  o se está calculando:
  - cadena de reintento por plato y segundo modelo de otra familia;
  - si el texto es vago, se pregunta a la persona;
  - un ingrediente que pesa nunca cae en un genérico (alimento más parecido, y después USDA);
  - los platos del plan se calculan todos al generarlo, y uno que no se puede calcular se cambia
    antes de guardar.

  Tickets 13, 06 y 22.

## Arquitectura objetivo

```
perfil (onboarding normalizado: actividad del día a día + rutina, marcas especiales)
  │  energyTargets() — código (07, 15)
  ▼
objetivo del día + reparto por comida + ración personal (21) ── la ÚNICA cifra de objetivo
  │
  ├─► plan mensual: la IA compone cada comida (plato · acompañamiento · postre) con sus kcal (23);
  │   planFit lo comprueba (10); todos sus platos se calculan al generarlo (06)
  │
plato (texto libre del plan, de "comí distinto" o del chat)
  │  dishKey(): normalizar
  ▼
dish_recipes (caché GLOBAL, 06) ── acierto ──► receta canónica (1 ración base AESAN, gramos crudos,
  │ fallo                                       método, plato/unidad)
  ▼
1 lectura estructurada (05; si falla, 2.º modelo, 13) → casado con foods (14, 22 → 03/04)
  → aceite por método (código)
  → validateRecipe (código) → 1 reintento con pista → guardar
  [solo si el eval lo pide: + lecturas independientes y juez (20)]
                                                                  │
                                                                  ▼
             al generar el plan, por día y comida (08):
               · comida compartida → sharedPortion(): UNA ración para todos los adultos
               · comidas propias   → alignSoloMeals(): cierran el día de cada adulto
             planFit() comprueba el día y corrige una vez (10)
             factores guardados en PlanDay.portions
                                                                  │
                                                                  ▼
             macros = Σ gramos × foods / 100 (se recalculan al leer; nunca se guardan)
             todo plato sale de su receta; si aún no, "Calculando…" y se reintenta (13, D13)
                                                                  │
                                                                  ▼
       Hoy · receta visible (09) · detalle de día · plan · compra derivada (11)
       (todo respeta profiles.nutrition_numbers: mostrar | ocultar)
                                                                  │
"comí distinto" (17, ración habitual del 21) · picoteo · deporte neto (16)
  ▼                                                               │
settleDay: UN asentamiento por día (balance-del-dia), kcal + proteína (13)
  ▼
distributeDelta(): raciones de las comidas propias de los días siguientes, en código (12)
  → la tarjeta "Balance de hoy" enseña lo movido, medido
```

## Invariantes

1. **El modelo nunca escribe una cifra que se enseñe o se sume** (kcal, macros, gramos finales,
   precio). Las lecturas proponen la composición de la receta base; el código valida, recorta y
   escala.
2. **Ninguna receta se usa sin pasar `validateRecipe`.** Las de una sola lectura se priorizan para la
   revisión manual por uso (`hits`). Si el eval demuestra que una lectura no basta, se exige una
   fuente independiente (20). Sustituye a "ninguna receta con una sola fuente", que dependía del
   diseño de tres lecturas (ver D7).
3. **Gramos en crudo en toda la cadena**, salvo los alimentos con `state: "listo"` (D8).
4. **Las macros se recalculan al leer** (`ingredientes × foods × factores`). Lo que se guarda son
   la receta y los factores de ración, nunca las cifras.
5. **`dish_recipes` es global y solo escribe el servidor** (`service_role`).
6. **Módulos puros sin `*.server`.** `foods` sigue fuera del bundle del navegador.
7. **`profiles.nutrition_numbers` manda en todas las superficies**: web, móvil, coach, push. Con
   `ocultar` no aparece ninguna cifra de kcal, macro u objetivo; los gramos de receta sí.
8. **Hogar: una sola ración compartida por comida para todos los adultos.** La desviación de cada
   adulto se corrige solo en sus comidas no compartidas. Nunca se expone el objetivo, el peso ni las
   cifras de un miembro a otro: solo se ven los gramos del plato compartido.
9. **Los factores de ración se fijan al generar el plan** y solo se recalculan por evento (cambio
   de la mesa, cambio del objetivo de un adulto > 5 %, reajuste). Hoy y los días pasados no se
   reescriben. Recolocar platos no cambia la compra. Paridad web/móvil vía `/api/v1`.
10. **No se usan modelos caros en producción** fuera del techo de ~1 €/mes por usuario intensivo
    (memoria `ai-plan-quality-cheap-model`). Las llamadas adicionales se pagan una vez por plato
    para toda la app, y ningún ahorro se acepta si el eval muestra peores cifras.
11. **La compra nunca se recorta en cantidad** para cuadrar el presupuesto: se cambian platos o se
    avisa.
12. **Un solo objetivo en toda la app.** La barra, el semáforo, el texto de la guía, el coach y las
    notificaciones salen de `energyTargets`. El modelo no escribe objetivos.
13. **Ningún plato se enseña ni se suma con un promedio** (D13). Cada cifra sale de una receta o la
    escribe la persona (`manual`). Lo que aún no se ha calculado se dice ("Calculando…") y no
    cuenta, ni para la barra ni para ningún desvío.
14. **El aceite de cocinar lo pone el código según el método**; el modelo solo clasifica el método.
15. **El gasto del deporte depende del peso y es neto; la rutina habitual no se compensa dos
    veces** (D9).
16. **Todo ajuste automático del plan se enseña con su efecto medido** (memoria
    `plan-changes-visible-to-user`). Lo que la tarjeta dice haber movido es lo que el código midió.
17. **La ración es personal** (21):
    - Platos del plan: receta base × factor `plan` (objetivo ÷ 2.000); con el 08, factores por grupo
      que parten de ahí.
    - "Comí distinto": × factor habitual (mantenimiento ÷ 2.000).
    - En las comidas compartidas del hogar, el factor es la media de los adultos y es igual para
      todos (D4).

## Tickets y orden

### Fases

| Fase | Tickets | Qué se consigue | IA nueva |
|---|---|---|---|
| 0 · en curso | 02 golden set y eval | medir antes de tocar | — |
| **1 · cifras honestas y objetivo personal** | 13, 14, 01, 07 | todo plato calculado, sin promedios; un objetivo por persona y una sola cifra en pantalla; sesgo de raciones corregido | un 2.º modelo solo cuando el primero falla |
| **2 · una receta, las mismas cifras, tu ración** | 05, 06, 22, 21, 23, 17, 16, 18 | receta canónica validada y en caché; todos los platos del plan calculados al generarlo; ingredientes desconocidos desde USDA; ración personal en Hoy y en "comí distinto"; plan con estructura de comida; deporte con el peso; el reajuste actual, medido | una lectura por plato nuevo, una vez; USDA gratis |
| **3 · plan personalizado de verdad** | 08, 09, 15, 10, 12, 11, 03, 04 | escalado fino por grupos que cierra el día de cada adulto; receta = cifras = compra; plan comprobado contra el objetivo; reajuste en código; tabla v2 | igual o menos |
| 4 · afinado que decide el eval (opcional) | 20, 19 | fuentes independientes si hacen falta; calibración con el peso | ≈ 0,01 $ por plato nuevo (20) |

### Dependencias

```
FASE 1
  13 todo plato calculado ─────────────────────────────────────────┐
  14 raciones AESAN, aceite y filas urgentes ─┬─► 05                │
                                              └─► 22 USDA           │
  01 ver cifras ─► 07 objetivo energético ─┬─► 16 deporte           │
                                           └─► 15 necesidades       │
FASE 2                                                              │
  07 + 14 ─► 21 ración personal ─► 23 plan con estructura           │
  05 receta validada ─► 06 caché ─► 18 puente: medir el reajuste    │
  05 + 06 + 21 ─► 17 "comí distinto" proporcional a la persona      │
FASE 3                                                              │
  06 + 07 + 21 ─► 08 escalado fino ─► 09 receta visible             │
  08 + 15 + 23 ─► 10 plan comprobado ─► 11 compra derivada          │
  08 + 13 + 16 ─► 12 reajuste en código (retira el 18) ◄────────────┘
  02 ─► 03 tabla v2 ─► 04 casado v2

FASE 4 (opcional)
  04 + 08 ─► 20 fuentes independientes (solo si el eval lo pide)
  07 + 12 + 16 ─► 19 calibración con la tendencia de peso
```

- Tras la fase 1 y tras el 06 se vuelve a pasar el eval sobre el **mismo** golden set y se compara
  con la línea base del 02. Los resultados se apuntan aquí y se le enseñan al usuario (memoria
  `macro-accuracy-foundation`).
- **14, 21 y 23 se despliegan juntos.** Con la ración de AESAN y un solo plato por comida, un día
  planificado se queda corto (≈ 960 kcal para la persona de referencia). La ración personal (21) lo
  haría visible en Hoy, y la estructura de comida (23) lo cierra. Los planes ya generados del mes en
  curso se quedan como están; Hoy explica que se hicieron antes de calcular el objetivo.
- Las cifras que ve la gente cambian tres veces: al corregir raciones y aceite (14), al aplicar la
  ración personal (21) y con el escalado fino (08). Es lo esperado.

### Cobertura de la auditoría

| Hallazgo | Ticket |
|---|---|
| A1 / H1, H13, H14 · sin objetivo, dos cifras, semáforo | 07 |
| H15 · vocabulario de actividad, rutina mezclada | 07 (entradas), 16 |
| A2 / H2, H24 · ración igual para todos; un plato por comida se queda corto | 14 (anclas AESAN), 21 (ración personal), 23 (estructura), 08 (escalado fino), 10 |
| A3 / H9, H11 · tres fuentes de gramos, recorte por presupuesto | 09, 11 |
| A4 / H19 · compensación sin medir | 18 (puente), 12 |
| B1 / H4, H22 · casados erróneos | 14 (filas urgentes), 03, 04 |
| B2 / H8 · calidad por gramos | 14 (por kcal), 05 (umbral 0,90) |
| B3 / H3, H23 · crudo y cocinado | 14 (salmón y filas con `cookedYield`), 05 (D8), 03 |
| B4 · aceite | 14 (tabla por método), 05 (`validateRecipe`) |
| B5 / H16 · promedio de 600/500 kcal al fallar | 13 (fuera; cadena de cálculo), 06 (plan calculado al generarlo), 22 |
| B6 / H17 · regla de proteína muerta | 13, 12 |
| H18 · fallos en silencio | 13 (reintento y registro), 05 (salida estructurada) |
| B7 / H6 · no determinista | 06 |
| B8 / H20 · deporte | 16 (y la rutina en 07) |
| B10 / H21 · cantidad en "comí distinto" | 21 (factor por persona), 17 |
| H25 · necesidades especiales | 15 |
| ±10 % de la fórmula entre personas | 19 (opcional) |

## Coste

- **Fases 1-3:** una lectura estructurada por **plato nuevo**, una sola vez para toda la app (caché
  global). Un plato ya visto cuesta 0, y la guía diaria deja de descomponer lo que ya está en caché:
  menos llamadas que ahora. El modelo lo elige el A/B del 05 (el más barato que cumpla), dentro del
  techo de ~1 €/mes.
- **Ticket 20 (solo si el eval lo pide):** 2 lecturas Gemini 2.5 Flash (≈ 0,003 $) + Sonar con
  búsqueda (≈ 0,007 $) + juez GPT-5 mini en ~⅓ de los platos (≈ 0,005 $ × ⅓) ≈ **0,01-0,015 $ por
  plato nuevo**. Así, 1.000 platos nuevos ≈ 10-15 $.
- **Tickets 07, 08, 12, 16, 19 y 21:** solo código.
- **Ticket 13:** el segundo modelo y la desambiguación (Flash-Lite) solo cuando hacen falta.
- **Ticket 22:** consultas a USDA FoodData Central, gratuitas con clave; se guardan para toda la
  app.

## Riesgos

- **Alcance grande.** Las fases permiten parar tras cualquiera con valor entregado; la fase 1 sola
  ya arregla lo que más se nota (objetivo, semáforo, desvíos fantasma).
- **El golden set depende de revisión humana** (idealmente de alguien con formación en nutrición).
  Lo mismo vale para las reglas del 15.
- **Perfiles antiguos:** su `activity_level` mezcla deporte y día a día. Mientras no se rellene la
  rutina, se usa su factor antiguo y todo el deporte registrado cuenta como extra (07, 16).
- **Latencia con caché vacía:** sin promedios, un plato nuevo enseña "Calculando…" hasta que está
  (segundos). Los platos del plan se calculan todos al generarlo (06); en Hoy solo le pasa a lo que
  se escribe a mano.
- **Tope de gasto:** para cumplir D13, la descomposición de un plato no la corta el tope diario (sí
  el mensual). Queda documentado junto a `AI_SPEND_CAPS` (13).
- **Hogar sin comidas propias:** si un adulto comparte todas sus comidas, no hay dónde corregir su
  desviación. Se avisa (si ve cifras) y el coach sugiere añadir una merienda (ticket 08).
- **Las cifras que la gente ya ve van a cambiar** (14 y 08). Es lo esperado.
- **Privacidad en el hogar:** calcular la ración compartida exige leer en servidor datos de otros
  miembros (peso, altura…). Solo `supabaseAdmin` con columnas limitadas; nunca viajan al cliente.
- **Necesidades especiales:** la app no es un servicio médico. Las marcas solo restringen y siempre
  remiten a un profesional (D11).
- **Calibración (19):** el peso tiene ruido de agua y el registro de lo comido es grueso. Por eso
  hay pasos pequeños, un tope y un mínimo de pesajes.

## Fuera de alcance

Micronutrientes, sodio y azúcares (campos reservados en `foods`), objetivos por edad para niños
(EFSA), códigos de barras, registro libre en gramos con báscula, y cualquier pauta médica cerrada
(dietas renales o para diabetes completas: la app solo aplica topes prudentes).

## Documentación que hay que actualizar al cerrar

CLAUDE.md y AGENTS.md: macros, receta canónica, fuentes, objetivo, ración compartida, preferencia
de cifras, rutina y deporte neto, necesidades especiales y reajuste en código. También
`docs/agents/testing.md` y `.scratch/nutricion-determinista/spec.md` (ya apunta aquí).

## Comments

- 2026-09-15 — Decisiones D1-D6 cerradas por el usuario. Cambios respecto a la propuesta: D3 pasa
  de "ocultar según `ed_history`" a preferencia explícita en onboarding y Ajustes; D4 pasa de
  "ración de cada adulto según su objetivo" a "ración compartida igual para todos, corrección en las
  comidas propias"; se añade D6 (fuentes independientes baratas) tras comparar precios en el
  catálogo de OpenRouter y las condiciones de Edamam, FatSecret y Nutritionix.
- 2026-09-24 — **Cambios desde que se cerraron las decisiones**, a tener en cuenta en 03 y 05:
  `DISH_MODEL` ya no es Gemini Flash sino `openai/gpt-5` (`49c6914`, elegido en una prueba de 10
  platos; el usuario aceptó el 2026-09-19 modelos más caros fuera del chat con un techo de ~1 €/mes
  por usuario intensivo), así que el A/B del 05 debe incluirlo como variante. El H3 se atacó con
  `cookedYield` sobre filas COCINADAS (`17a00d4`), lo contrario del invariante 3 ("gramos en crudo
  en toda la cadena"): el ticket 03 decide cuál se queda. Salmorejo y embutidos ya tienen fila
  propia (`17a00d4`, `a64789d`), parte del H4.
- 2026-09-24 — **Línea base PROVISIONAL (ticket 02)**: 75 recetas en borrador sin revisar,
  `openai/gpt-5`, 3 pasadas (`src/lib/plan-eval/baseline-recipes.json`). Se vuelve a fijar
  cuando la revisión humana termine.

  | Métrica | Línea base | Objetivo |
  |---|---|---|
  | kcal por ración, error medio / P90 | 23,2 % / 44,5 % | ≤ 6 % / ≤ 12 % |
  | kcal por 100 g (densidad), error medio | **5,2 %** | ≤ 6 % ✓ |
  | reparto de macros | 5,3 pts | ≤ 3 pts |
  | proteína por ración, error medio | 23,3 % | ≤ 8 % |
  | ingredientes principales omitidos | 9,2 % | ≤ 1 % |
  | mismo plato → mismas cifras (CV entre pasadas) | 3,9 % | 0 % |

  Sesgo de kcal **+21,5 %**: 52 de 75 platos por encima del +10 %, solo 3 por debajo del −10 % (los
  tres de arroz integral: el ancla de 150 g cocido se queda corta). La densidad ya cumple: **el
  modelo acierta la composición y se pasa en la cantidad**. Lo que empuja hacia arriba en los peores
  platos: aceite (suelo de 25 g en fritos frente a ~14 g medidos; 20 g en la plancha; 10 g en una
  tostada), huevos (2 donde la ración de AESAN es 1), carne (muslo +117 % en gramos), pan 60 g
  frente a 50, fruta de topping entera (150 g de plátano en un yogur), cremas de ración grande con
  patata inventada. Tabla (17 referencias externas, sin llamadas): 64,7 % casado a la fila
  correcta, 25,3 % de error medio en kcal/100 g, 5 filas que faltan. Disponibilidad: 24 de 225
  pasadas sin descomponer (lotes enteros, sin error registrado; tarea aparte). Latencia: ~59 s por
  lote de 8 platos.
- 2026-09-24 — **Replanificación tras la auditoría** ([auditoria-2026-09-24.md](auditoria-2026-09-24.md)).
  El plan anterior no cubría: H13-H21 y H25; las anclas del 05, que contradecían AESAN; y un 12
  anterior a `balance-del-dia`. Cambios:
  - Orden por fases (D7): objetivo y cifras honestas primero; fuentes independientes al final y solo
    si el eval las pide.
  - El 05 se divide: una lectura validada (05) y fuentes independientes (20, nuevo).
  - Se reescriben el 07 (entradas normalizadas, rutina, una sola cifra, semáforo) y el 12 (sobre
    `settleDay`, cambios de ración visibles).
  - El §7 del 08 pasa al 17.
  - Tickets nuevos: 13 cifras honestas · 14 raciones AESAN, aceite y filas urgentes · 15
    necesidades especiales · 16 deporte · 17 cantidad en "comí distinto" · 18 puente para medir el
    reajuste · 19 calibración con el peso · 20 fuentes independientes.
  - Se mantienen los números 01-12 porque el código y otros specs los citan.
  - D7-D12 quedan propuestas hasta que el usuario las confirme.

- 2026-09-24 — **El usuario confirma D7-D12** y añade dos cosas:
  1. **D13:** todo plato se calcula ("no vale poner un average de 600 kcal y adiós").
  2. **D10 revisada** con su propuesta: la cantidad de "comí distinto" es aproximada, pero
     proporcional a la necesidad calórica de cada persona ("si un hombre corpulento que come mucho
     dice que comió un plato de pasta, la ración será superior a la de una mujer pequeña").

  Cambios:
  - 13 reescrito: sin respaldo; cadena de cálculo; preguntar lo vago; ingredientes que pesan nunca
    genéricos.
  - 06 calcula todos los platos del plan al generarlo.
  - 17 reescrito y pasa a la fase 2.
  - Tickets nuevos: 21 (ración personal: factor `plan` = objetivo ÷ 2.000 para los platos del plan y
    factor habitual = mantenimiento ÷ 2.000 para "comí distinto"), 22 (ingredientes desconocidos
    desde USDA) y 23 (estructura de comida en el prompt del plan, que sale del 10).
  - 08 parte de la ración personal.
  - 14, 21 y 23 se despliegan juntos: con la ración de AESAN y un plato por comida, el día se queda
    corto.

- 2026-09-25 — **Fase 2 implementada en código (sin desplegar).** Tickets 05, 06, 14, 16, 17, 18,
  21, 22 y 23; estado y pendientes en cada ticket. `eval:recipes` (2.ª iteración): sesgo +21,5 % →
  +6,6 %, error por ración 23,2 % → 10,8 %, proteína 23,3 % → 10,4 %, casado de la tabla 64,7 % →
  100 %; la densidad empeora (5,2 % → 12,6 %, masa de líquido). `eval:plan-lite`: 5/21 días a ±15 %
  del objetivo (objetivo ≥ 70 %), sesgo a la baja: la estructura de la comida en el prompt no cierra
  el día. Como 14, 21 y 23 se despliegan juntos, no se despliega hasta decidir cómo cerrarlo (10/08).
