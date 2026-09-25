# 19 — Calibración del gasto con la tendencia de peso (opcional)

Status: propuesta — requiere D12
Blocked by: 07, 12, 16
Tamaño: M
Fase: 4

## Qué

La fórmula de Mifflin-St Jeor acierta el gasto de la mayoría de las personas con un margen de
±10 %. Con pesajes suficientes, el propio peso dice si el objetivo va bien. Este ticket corrige el
gasto estimado de cada persona **en pasos pequeños y acotados**, y se lo explica.

## Por qué

Es la única forma de que el objetivo sea fiable **para esa persona** y no para la media. Sin esto,
alguien a quien la fórmula le sobreestima un 10 % el gasto puede seguir el plan al pie de la letra
sin perder peso, y la app no se entera.

## Diseño — `calibrateExpenditure(history) → { factor, reason } | null` (puro)

- **Datos:** pesajes (`daily_logs.weight_kg` y la herramienta `actualizar_peso` del chat) y
  adherencia (proporción de comidas marcadas "según el plan" o con cifra propia).
- **Cuándo:** por evento, al registrar un peso, como mucho una vez cada 3 semanas. Nunca por cron.
- **Requisitos:**
  - ≥ 8 pesajes en las últimas 4 semanas.
  - Adherencia ≥ 70 %.
  - Sin embarazo ni lactancia, y sin la marca `diabetes_hipo` (15).
- **Cálculo:**
  - Tendencia del peso (media móvil exponencial o regresión, robusta al agua).
  - Cambio esperado = Σ (kcal objetivo − gasto estimado) ÷ 7.700 kcal/kg.
  - Si lo observado difiere del esperado en más de 0,25 kg por semana, `factor` se corrige ±5 % por
    ciclo, con un tope de ±10 % acumulado sobre la fórmula.
- **Aplicación:** `energyTargets` multiplica el gasto por `profiles.expenditure_factor`. Se
  recalculan los factores de ración por evento (08). Hoy y el pasado no se tocan.
- **Qué ve la persona** (con `mostrar`): "Tu peso bajó más despacio de lo previsto: he ajustado tu
  gasto estimado un 5 %". Con `ocultar`, sin cifras. Se puede deshacer en Ajustes.

## Archivos

- `src/lib/nutrition/calibration.ts` + test (puro)
- `src/lib/nutrition/energy.ts`, migración `profiles.expenditure_factor`
- Aviso en Hoy o en Ajustes (web y móvil)

## Criterios de aceptación

- [ ] Tests con series sintéticas: sin cambios cuando cuadra; +5 % cuando pierde de más; tope
      ±10 %; nada sin pesajes o sin adherencia suficiente.
- [ ] Nunca baja el objetivo por debajo del suelo del 07.
- [ ] Navegador (perfil demo con pesajes): aparece el aviso y se puede deshacer.

## Comments
