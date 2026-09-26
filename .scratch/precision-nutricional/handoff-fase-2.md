# Relevo — fase 2 de `precision-nutricional` (2026-09-25)

Para retomar en una sesión nueva. El detalle de cada ticket está en sus `## Comments`
(`issues/05, 06, 14, 16, 17, 18, 21, 22, 23`) y el resumen en el `spec.md`.

## Estado

- **Desplegado** el 2026-09-25: commit `799e486` en `main`, integrado encima de los tres commits de
  la otra sesión (registro de deporte y picoteo del chat vía `logExercise`/`settleDay`). CI verde y
  producción sirviendo la versión nueva. Tras integrar: 724 tests, typecheck web y móvil, drift,
  lint (0 errores) y build de producción en verde. La app iOS necesita una build nueva de EAS para
  llevarlo al móvil.
- **Supabase de producción: hecho.** Tablas `dish_recipes` y `foods_extra` creadas y
  `increment_dish_recipe_hits` cerrada a `anon`/`authenticated`. Comprobado con la clave
  publishable: no puede insertar, modificar ni llamar a la función; la clave de servicio sí.
- **Falta** `USDA_FDC_API_KEY` en `.env` y Vercel (clave gratuita de api.data.gov). Sin ella el
  código funciona y no busca en USDA.

## Mediciones

- `bun run eval:recipes` (GPT-5, 3 pasadas): sesgo +21,5 % → **+6,6 %**, error por ración 23,2 % →
  **10,8 %**, proteína 23,3 % → **10,4 %**, casado de la tabla 64,7 % → **100 %**, sin descomponer
  24 → 1/225. Empeora la densidad (5,2 % → 12,6 %, masa de líquido de cremas y guisos).
- `bun run eval:plan-lite`: **5/21 días a ±15 % del objetivo** (se pedía ≥ 70 %), sesgo a la baja en
  las tres tipologías; 8/42 comidas principales de un solo componente. La estructura de la comida
  en el prompt no cierra el día.

## Escalado al objetivo (08 adelantado, 2026-09-25, segunda sesión)

Cada plato del plan se sirve al objetivo de su comida (`scale.ts`, `planned-serving.server.ts`):
verdura fija, grupos proteína y energía con límites, calculado al leer. "Comí distinto" se escala
igual a la ración habitual (si no, todo cambio de plato parecía comer menos). La compensación de
`settleDay` guarda lo que mueve cada plato en `PlanDay.kcalAdjust` (puente hasta el 12). Detalle en
el comentario del ticket 08.

`eval:plan-lite`, mujer que pierde (1.330 kcal), mismo plan: sin escalar −32 % a −51 %, escalado
**−8 % a −28 %**; la comida clava su objetivo todos los días. Lo que falta es estructura: meriendas
de una sola fruta (52-89 kcal para 160) y desayunos de solo yogur (125 para 333). Hombre y
"ganar": el eval quedó corriendo al cerrar, sin cifras.

## Cierre del día y piezas (2026-09-25, tercera sesión) — commit `03353af`, CI verde

- `closeDay` (`src/lib/nutrition/day-close.ts`, = `alignSoloMeals` del 08): lo que una comida no
  alcanza lo absorben las demás propias del día; una compartida cuenta con el objetivo PROPIO
  (`ResolvedServing.goal`). Se cierra siempre con los platos planeados (`plannedIdea` → `planned`
  en `guideMeals`). Detalle en el comentario del ticket 08.
- Piezas (`unidad`) del plan en unidades enteras, las más cercanas al objetivo (decisión del
  usuario). Aguacate y fruta desecada escalan como E (`DENSE_PRODUCE_KCAL`).
- `eval:plan-lite` (antes de los dos arreglos de la línea anterior): **18/21 días a ±5 %**, 20/21 a
  ±15 %. Hombre que mantiene y el que gana: 14/14. Mujer que pierde: 4/7; fallan por platos que
  no llegan ni al máximo (merluza con brócoli · yogur: 272 de 465). Proteína ≥ 90 %: 13/21 (los
  fallos, de la mujer). Comidas principales de un componente: 6/42.

## Pendiente

1. **Ticket 10, `planFit`: hecho (2026-09-26), sin commit al escribir esto.** Va tras el
   precalentado (`fitMonthlyPlan`, `/api/v1/plan/fit`), no al generar: no cabe en 300 s. Detalle y
   cifras en los comentarios del ticket 10. Falta navegador/simulador y más tipologías en el eval.
2. `eval:plan-lite` re-corrido: kcal a ±5 % 21/21 sin ronda; con la ronda y las dos redes de
   proteína, la mujer que pierde pasa de 1/7 a 6/7 días con proteína ≥ 90 %.
3. Verificación en navegador (perfil demo) y simulador iOS de Hoy con el día cerrado.
4. Ticket 12: compensar en código escribiendo `kcalAdjust` sin cambiar platos.
5. Ticket 11: la compra sigue saliendo del modelo, no de las raciones escaladas.
6. Hogar: búsqueda del multiplicador `m` sobre las compartidas (08 §2.3) solo si un adulto no
   tiene margen en sus propias. Privacidad: con dos adultos, las kcal de una compartida ≈ objetivo
   medio (ya pasaba); decidir si importa.
7. Falta `USDA_FDC_API_KEY` en `.env` y Vercel.

## Lo que no se hizo

- A/B de modelos del 05 (Flash con y sin razonamiento).
- Kcal antes de guardar en "comí distinto" (17).
- Sustituir un plato del plan que no se deja calcular (06): hoy queda "calculando" y se reintenta.
- Chistorra y muesli sin fuente fiable; verificar con USDA los `fdcId` de la patata (170026 /
  170438) y del salmón crudo (175167).
