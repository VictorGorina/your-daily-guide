# 21 — Ración personal: un factor por persona a partir de su objetivo y su gasto

Status: implementado (2026-09-25, sin desplegar)
Blocked by: 07, 14
Tamaño: M
Fase: 2
Se despliega junto con: 14 y 23 (ver "Consecuencia" abajo)

## Qué

`portionFactors(targets, profile) → { plan, habitual }` (puro, `src/lib/nutrition/portion.ts`):

- **`plan`** = objetivo del día ÷ 2.000 kcal. Es el tamaño de los platos **del plan** para esa
  persona.
- **`habitual`** = gasto de mantenimiento (`basis.tdee` del 07) ÷ 2.000 kcal. Es lo que suele
  servirse **fuera del plan**; lo usa "comí distinto" (17).
- Los dos entre **0,6 y 1,7**.
- **Sin objetivo** (faltan altura, peso o edad): por sexo, hombre 1,25 · mujer 1,0 · otro o sin
  dato 1,12 (referencias de 2.500, 2.000 y 2.250 kcal).
- **2.000 kcal** es la ingesta de referencia de un adulto medio (Reglamento UE 1169/2011, anexo
  XIII): la persona para la que está pensada una ración de AESAN.

## Por qué

- Objetivo del usuario: un plan personalizado para cada tipo de usuario, y en "comí distinto" una
  cantidad según la persona (D10). Hoy la ración es la misma para una mujer de 1.300 kcal que para un
  hombre de 3.400.
- El escalado fino por grupos (08) llega en la fase 3. Este factor hace personales las cifras de Hoy
  ya en la fase 2, y el 08 parte de él.
- Si "comí distinto" usara un factor y el plan no, cada cambio de un hombre grande parecería un
  exceso. El desvío tiene que comparar dos cifras a la misma escala.

## Diseño

### Dónde se aplica

- **Hoy** (`macrosFromLookup`): cada plato planificado = receta canónica base × `plan`.
  - **Comidas propias:** el factor de la persona.
  - **Comidas compartidas del hogar:** la **media de `plan`** de los adultos con cuenta que comen en
    casa esa comida. Es el mismo número para todos (D4). Se calcula en servidor con `supabaseAdmin`
    y columnas limitadas; nadie ve el factor ni el objetivo de otro miembro.
- **"Comí distinto"** (17): ración base del plato cambiado × `habitual`.
- **Escalado lineal:** todos los ingredientes, aceite incluido. Es "tu plato", una aproximación. El
  08 lo sustituye en los platos planificados por factores por grupo (proteína, energía, verdura) que
  **parten de este mismo punto**.
- **Días pasados:** el factor usado se guarda en la guía del día (`guide.portionFactor`), igual que
  el objetivo (07), para que el detalle de un día pasado no cambie si cambia el peso.
- **Transparencia** (con `mostrar`): Ajustes enseña "Tus raciones: ×1,2 de la ración de referencia
  (según tu objetivo)", junto a la explicación del objetivo (07).
- El plan en sí no cambia: solo cambian las cifras de cada plato en Hoy y en el detalle del día. La
  receta visible (09) y la compra (11) usarán los mismos gramos cuando lleguen.

### Consecuencia (importante)

Con la ración de AESAN (14) y **un solo plato por comida**, un día planificado suma poco: los 4
platos del golden set dan ≈ 960 kcal a la persona de referencia. Con el factor, Hoy enseñará de
verdad que el plan se queda corto frente al objetivo. Es cierto, pero confunde. Por eso:

- **14, 21 y 23 se despliegan juntos.** El 23 pide al plan la estructura de comida (plato +
  acompañamiento + postre) que cierra el día.
- Los planes **ya generados** del mes en curso se quedan como están. Hoy lo explica con una línea:
  "Tu plan de este mes se hizo antes de calcular tu objetivo: el mes que viene cuadrará".

## Ejemplos para los tests

| Perfil | Objetivo | Mantenimiento | `plan` | `habitual` |
|---|---|---|---|---|
| Mujer, 32 años, 62 kg, sedentaria, perder | 1.312 | 1.574 | 0,66 | 0,79 |
| Hombre, 40 años, 85 kg, ligero, mantener | 2.448 | 2.448 | 1,22 | 1,22 |
| Hombre, 24 años, 78 kg, alto, ganar | 3.442 | 3.142 | 1,70 (tope) | 1,57 |
| Hombre sin altura | — | — | 1,25 | 1,25 |
| Hogar: comida compartida entre 0,66 y 1,22 | — | — | 0,94 para los dos | — |

## Archivos

- `src/lib/nutrition/portion.ts` + test (puro)
- `src/lib/guide.functions.ts` (`macrosFromLookup`), `src/lib/household.server.ts` (media de los
  adultos)
- Ajustes (web y móvil), copias en `mobile/lib/`

## Criterios de aceptación

- [ ] Los ejemplos como tests, incluidos los topes y el caso sin datos.
- [ ] Test de privacidad: la respuesta de un adulto no contiene el factor, el objetivo ni el peso de
      otro.
- [ ] Navegador (perfil demo): cambiar el peso en Ajustes cambia las kcal de los platos de hoy tras
      regenerar la guía, no las de los días pasados.
- [ ] Simulador iOS: las mismas cifras que la web.

## Comments

- 2026-09-25 — **Implementado**: `portion.ts` + tests con los ejemplos, `sharedMealPortions`
  (media de los adultos con la clave de servicio), guía con `portionFactor` y factor por comida
  (no en las compartidas: con el propio dejaría despejar el de la pareja), línea en "Mis
  respuestas" (web y móvil; vista en el navegador: "×0,89"). Pendiente: la prueba de hogar en el
  navegador.
