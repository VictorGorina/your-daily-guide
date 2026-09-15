# 09 — La receta que ve la persona es la receta canónica

Status: ready (D1 aprobada)
Blocked by: 06, 08
Tamaño: M

## Qué

`dishRecipe` deja de inventar ingredientes y cantidades. La lista sale de la receta canónica con los
factores de ración de ese día (tickets 06 y 08), con gramos. El modelo solo redacta los **pasos**
para esa lista cerrada.

## Por qué

Hallazgo H9. Si la receta dice 100 g de pasta y la barra calcula otra cantidad, quien pesa lo que
pone la receta come unas macros que no son las que ve. Con D1 los gramos se enseñan, así que tienen
que ser exactamente los que se usan en los cálculos.

## Diseño

- `dishRecipe(dish, month, date?, slot?)`:
  1. `getRecipes([dish])` → factores de `PlanDay.portions[slot]` de esa fecha. Sin fecha o sin
     factores → `alignSoloMeals` al vuelo; sin objetivo → ración base.
  2. Texto por ingrediente: `"75 g de lentejas secas (unos 180 g cocidas)"`, `"1 cda de aceite de
     oliva (10 g)"`, `"2 huevos"`.
  3. Prompt al modelo: la lista cerrada + "redacta 3-5 pasos; no añadas ingredientes salvo sal, agua
     y especias". Comprobación suave: si un paso nombra un alimento que casa con `foods` y no está en
     la lista, se registra en el log (no se bloquea).
- **Comida compartida (D4):** "Tu ración" es la misma que la de todos los adultos, y debajo "Para
  la mesa (N raciones)" con el total para cocinar: adultos × ración compartida + niños × su
  `portion`.
- **Preferencia de cifras (ticket 01):** con `mostrar`, kcal y macros de la ración debajo de los
  ingredientes; con `ocultar`, no. Los gramos se enseñan en los dos casos.
- La receta de un día pasado conserva los factores guardados de ese día.

### Forma de la respuesta (compatible hacia atrás)

```ts
type DishRecipe = {
  ingredients: string[];           // se mantiene: el móvil actual lo pinta
  steps: string[];
  items?: { name: string; grams: number; cookedGrams?: number; unitText?: string }[];
  macros?: Macros;                 // ausente con nutrition_numbers = "ocultar"
  forTable?: { servings: number; items: { name: string; grams: number }[] };
};
```

`/api/v1/plan/recipe` no cambia de ruta (invoca la misma server function).

## Archivos

- `src/lib/plan.functions.ts` (`dishRecipe`)
- Componente de receta en web y en móvil

## Criterios de aceptación

- [ ] Para un plato, una persona y un día, los gramos de la receta son exactamente los que usa la
      barra de Hoy (perfil demo: abrir la receta y comparar con `guide.mealMacros`).
- [ ] Abrir la receta dos veces da los mismos ingredientes y gramos.
- [ ] En un hogar, dos adultos ven la misma "Tu ración" en una comida compartida.
- [ ] Con `ocultar`, sin kcal ni macros, con gramos.
- [ ] Móvil antiguo sigue funcionando con `ingredients: string[]`.
- [ ] Simulador iOS: receta con gramos y bloque "Para la mesa".

## Comments
