# 17 — "Comí distinto": una cantidad aproximada, pero proporcional a cada persona

Status: implementado (2026-09-25, sin desplegar); falta el aviso de kcal antes de guardar
Blocked by: 05, 06, 21
Tamaño: M
Fase: 2
Sustituye: el §7 del ticket 08 ("pequeña / normal / grande × ración base") y la versión anterior de
este ticket ("la misma masa que el plato planificado")

## Qué

Cuando alguien cambia un plato en Hoy, nadie ha pesado lo que comió, así que la cantidad es una
**aproximación**. Pero depende de la persona: si un hombre corpulento que come mucho y una mujer
pequeña dicen "un plato de pasta", no han comido lo mismo. La cantidad se estima **en proporción a
la necesidad calórica de cada uno**.

## Por qué

- H21: hoy siempre se asume 1 ración de ancla, igual para todos.
- Propuesta del usuario (2026-09-24): "se podría hacer un cálculo proporcional a la necesidad
  calórica por usuario para poder determinar las cantidades de los platos de comí distinto".
- La versión anterior ("la misma masa que el plato planificado") fallaba al cambiar un plato poco
  denso por uno denso. Una ensalada de 350 g cambiada por pasta daba 350 g de pasta. La ración propia
  del plato nuevo × un factor de la persona no tiene ese problema.

## Diseño

### Orden de prioridad de la cantidad (D10)

1. **Lo que diga el texto:** "media pizza", "dos platos de lentejas", "un plato pequeño de pasta". La
   descomposición (05) devuelve `cantidad_texto`, y se aplica sobre 2 o 3.
2. **Unidad natural:** si la receta es `tipo_racion: "unidad"` (pizza individual, hamburguesa
   completa, bocadillo, kebab, croissant, menú del día = primero + segundo + postre), cuenta **1
   unidad, sin escalar por persona**. Una pizza pesa lo que pesa.
3. **Plato:** la ración base del plato (AESAN) × el **factor habitual** de la persona (ticket 21) =
   su gasto de mantenimiento ÷ 2.000 kcal, entre 0,6 y 1,7. Sin datos, por sexo: hombre 1,25 ·
   mujer 1,0 · otro 1,12.

**Por qué el gasto de mantenimiento y no el objetivo de dieta.** Fuera del plan, lo normal es
servirse el plato de siempre, no el de la dieta. El plan sí usa el objetivo (21, factor `plan`), así
que el desvío recoge también que alguien que está perdiendo peso, al salirse del plan, se sirve más.
Para quien mantiene, los dos factores coinciden.

### Ejemplo: "un plato de pasta con tomate"

La ración de referencia es 70 g de pasta seca con su salsa y aceite, unas 400 kcal:

| Persona | Gasto de mantenimiento | Factor | Pasta seca | kcal aprox. |
|---|---|---|---|---|
| Mujer pequeña: 30 años, 155 cm, 50 kg, trabajo sentado | ~1.390 | 0,69 | ~48 g | ~280 |
| Hombre, 40 años, 180 cm, 85 kg, actividad ligera | ~2.450 | 1,22 | ~85 g | ~490 |
| Hombre corpulento: 45 años, 185 cm, 105 kg, trabajo físico | ~3.080 | 1,54 | ~108 g | ~615 |

Los valores exactos se fijan en los tests con la receta canónica real.

### Chips de tamaño

- En la hoja de "comí distinto" (web y móvil): **pequeño · normal · grande** = ×0,75 · ×1 · ×1,3
  sobre la cantidad de 2 o 3, para el apetito del momento. No se enseñan si el texto ya trae
  cantidad.
- **Aprende el tamaño de cada persona:** si en sus últimas 5 veces eligió el mismo tamaño distinto
  de "normal", ese pasa a ser el preseleccionado ("Sueles servirte más"). Cubre a quien come más (o
  menos) de lo que dice su gasto.
- Campo `habits[].portionSize?: "pequena" | "normal" | "grande"`, escrito por `patchTodayHabits`.
- Con `mostrar`, la hoja enseña las kcal estimadas antes de guardar, como el picoteo. Con
  `ocultar`, solo los chips.

### El desvío

- El plato cambiado y `plannedKcal` (congelado en `plannedIdea`) salen de la **receta canónica** de
  la caché (06): el planificado con el factor `plan` (21; con el 08, sus factores por grupo) y el
  cambiado con el factor habitual.
- Ninguno de los dos puede ser un promedio (D13, ticket 13). La proteína viaja igual.
- La tarjeta "Balance de hoy" lo cuenta: "Pasta con tomate (tu plato, ~490 kcal) en vez de lentejas
  (~430)".

## Archivos

- `src/lib/nutrition/portion.ts` (cantidad del plato comido), `src/lib/use-meal-swap.ts`
- `src/lib/plan-shared.ts` (`MealHabit.portionSize`), `src/lib/daily.ts`
- Hoja de "comí distinto" en web y móvil; copias en `mobile/lib/`

## Criterios de aceptación

- [ ] Test: "un plato de pasta" da más gramos a un perfil de 3.080 kcal de mantenimiento que a uno
      de 1.390, en la proporción de sus factores.
- [ ] Test: "una pizza" da las mismas kcal a los dos (unidad natural); "media pizza" = 0,5 unidades.
- [ ] Test: sin altura ni peso, un hombre usa 1,25 y una mujer 1,0.
- [ ] Test: el chip "grande" multiplica por 1,3; con cantidad en el texto no hay chips; tras 5
      "grande" seguidos, "grande" viene preseleccionado.
- [ ] Navegador (perfil demo): cambiar la comida por "un plato de pasta" enseña una cifra acorde al
      perfil y la tarjeta enseña el desvío.
- [ ] Simulador iOS: la hoja con chips.

## Comments

- 2026-09-24 — Reescrito con la propuesta del usuario (cantidad proporcional a la necesidad
  calórica). Pasa a la fase 2: depende del factor personal (21), no del escalado fino (08).

- 2026-09-25 — **Implementado** web y móvil: `eatenPortion` (texto → unidad → plato × habitual),
  chips con tamaño aprendido (`learnedPortionSize`, `MealHabit.portionSize`), la guía mide el plato
  comido con su ración y el del plan con el factor `plan`. **No hecho:** enseñar las kcal ANTES de
  guardar (haría falta un endpoint y 20-60 s de espera dentro de la hoja con un plato nuevo); la
  cifra aparece en la fila en cuanto se guarda.
