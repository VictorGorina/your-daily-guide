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

## Pendiente

1. **Ticket 10 propiamente dicho**: `planFit` + UNA ronda de cambio de platos para las comidas
   que no pueden llegar (sobre todo desayuno y merienda de un componente). El escalado no debe
   inflar una fruta.
2. `alignSoloMeals` (08): pasar el residuo de una comida a las demás del día y cerrar el día de
   cada adulto de un hogar. Cuidado: calcularlo sobre el plato PLANEADO (`plannedIdea`), no sobre
   el comido, o hoy se compensaría dentro del mismo día.
3. Verificación en navegador (perfil demo) y simulador iOS de Hoy con las cifras escaladas: el
   navegador integrado rechazó `localhost` en esta sesión.
4. Terminar `bun run eval:plan-lite` para el hombre que mantiene y el que gana.
5. Ticket 12: compensar en código escribiendo `kcalAdjust` sin cambiar platos (el campo ya existe).
6. Ticket 11: la compra sigue saliendo del modelo, no de las raciones escaladas.
7. Privacidad del hogar: con dos adultos, las kcal de una comida compartida ≈ objetivo medio, y
   con el propio se puede aproximar el del otro. Ya pasaba con el factor medio; decidir si importa.

## Lo que no se hizo

- A/B de modelos del 05 (Flash con y sin razonamiento).
- Kcal antes de guardar en "comí distinto" (17).
- Sustituir un plato del plan que no se deja calcular (06): hoy queda "calculando" y se reintenta.
- Prueba de hogar (media de los adultos) en el navegador y verificación en el simulador iOS.
- Chistorra y muesli sin fuente fiable; verificar con USDA los `fdcId` de la patata (170026 /
  170438) y del salmón crudo (175167).
