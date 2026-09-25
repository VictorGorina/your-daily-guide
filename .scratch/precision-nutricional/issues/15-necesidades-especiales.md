# 15 — Necesidades especiales: reglas más prudentes según el perfil

Status: propuesta — requiere D11 y que alguien con formación en nutrición revise las reglas antes de activarlas
Blocked by: 07
Tamaño: M
Fase: 3

## Qué

Algunas personas necesitan reglas distintas a las del objetivo general: enfermedad renal, diabetes,
dieta vegana o vegetariana. Este ticket deriva de lo que la persona ya ha contado unas **marcas**
cerradas y las aplica al cálculo, siempre en el sentido **más prudente**. Nunca sustituye a un
profesional.

## Por qué

- H25: hoy esas condiciones solo existen como texto en el prompt. El cálculo (07, 08, 10, 12) las
  ignoraría: subiría a 1,6 g/kg de proteína a alguien con enfermedad renal, o compensaría un exceso
  vaciando la cena de alguien que se pone insulina.
- Objetivo del usuario: un plan personalizado para cada tipo de usuario según sus necesidades.

## Diseño

### Marcas, sin preguntas nuevas (D11; memoria `onboarding-direction`)

- `nutritionFlags(profile): NutritionFlag[]` (puro, `src/lib/nutrition/flags.ts`), con estos
  valores: `renal` · `dialisis` · `diabetes` · `diabetes_hipo` (insulina o sulfonilureas) ·
  `vegano` · `vegetariano`. Embarazo y lactancia ya los trata el 07.
- **De dónde salen:**
  - `diet_pattern` normalizado da `vegano` y `vegetariano`.
  - `medical_conditions` y `medications` son texto libre: la extracción que ya existe
    (`parseOnboarding` y la herramienta `actualizar_perfil` del chat) devuelve además
    `condiciones_nutricionales: string[]` de la lista cerrada. No hay llamadas nuevas.
  - Un script de relleno, una sola vez, para las cuentas existentes (modelo barato, offline).
- Columna `profiles.nutrition_flags text[]`. Se ve y se corrige en Ajustes ("Tengo en cuenta: …").

### Reglas (solo restringen)

| Marca | Efecto en el cálculo |
|---|---|
| `renal` (sin diálisis o sin saber) | Proteína ≤ 0,8 g/kg del peso de referencia, sin la regla de 1,6 g/kg. El reajuste (12) nunca repone proteína. El coach recomienda consultar a su nefrólogo o dietista-nutricionista. |
| `dialisis` | Proteína 1,0-1,2 g/kg. El resto, igual que `renal`. |
| `diabetes` | Carbohidratos por comida proporcionales a su parte de kcal (sin comidas muy cargadas). El plan (10) prefiere hidratos con fibra. El reajuste (12) nunca baja una comida más de un 10 %. |
| `diabetes_hipo` | Lo anterior y **ninguna compensación a la baja** (como con el embarazo): el desvío queda apuntado. Déficit de perder como mucho del 15 %. |
| `vegano` / `vegetariano` | El objetivo de proteína no cambia. El plan (10) pide legumbre, soja o seitán (o huevo y lácteo) en comida y cena, y `planFit` comprueba que la proteína del día llegue al 90 %. |

- Si hay varias marcas, se aplica la más prudente de cada regla.
- El texto del coach y las notificaciones no nombran la condición salvo que la persona hable de
  ella.
- **Hogar:** las marcas son de cada adulto. No cambian la ración compartida (D4) y actúan en sus
  comidas propias. Nunca se exponen a otros miembros.

## Archivos

- `src/lib/nutrition/flags.ts` + test (puro)
- `src/lib/nutrition/energy.ts` (07), `src/lib/nutrition/reflow.ts` (12), `plan-fit.ts` (10)
- `src/lib/onboarding.functions.ts`, herramienta `actualizar_perfil`, `src/lib/profile-fields.ts`
- Migración `profiles.nutrition_flags`, script de relleno

## Criterios de aceptación

- [ ] Reglas revisadas por alguien con formación en nutrición (apuntado en Comments).
- [ ] Tests: cada marca modifica solo lo que dice la tabla; combinaciones → la más prudente.
- [ ] Test: `renal` + objetivo de perder + fuerza → proteína ≤ 0,8 g/kg.
- [ ] Test: `diabetes_hipo` + exceso de 500 kcal → sin compensación a la baja.
- [ ] Fixture de extracción: 10 textos de condiciones médicas → marcas esperadas (con el modelo, a
      mano; no entra en CI).
- [ ] Ajustes muestra y deja corregir las marcas (web y móvil).

## Comments
