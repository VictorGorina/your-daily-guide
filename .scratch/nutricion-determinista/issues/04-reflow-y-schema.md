# 04 — Salida por schema + reflow sobre números reales (DIFERIDA)

Status: deferred — decidir tras Fase 3

## Qué

- `askForJson` → `generateObject`/`streamObject` con schema Zod para el plan (los platos
  siguen siendo strings libres; se valida la estructura). Acortar/quitar el bucle de 3
  reintentos.
- `reflowMeals`: la compensación del desvío se calcula en **código** — `kcalDelta` repartido
  entre los próximos N días editables, con las kcal de cada plato futuro conocidas por
  lookup, eligiendo swaps más ligeros/completos entre platos cocinables con lo comprado +
  despensa. Fuera `FORCE_ADJUST_KCAL` y el "insiste una vez".

## Verificación
Navegador con perfil demo: generar plan, registrar "comí pizza y cerveza" en Hoy, los días
futuros se mueven y la compra no. Simulador iOS: `meal-swap-sheet` y el banner de ajuste.
