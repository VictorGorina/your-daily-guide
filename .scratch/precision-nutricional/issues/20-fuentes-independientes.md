# 20 — Fuentes independientes: lecturas de otros modelos, receta publicada y juez

Status: condicionado al eval — solo se hace si, después de 14, 05 y 08, el eval no alcanza los objetivos de omisiones, densidad o proteína
Blocked by: 04, 08
Tamaño: L
Fase: 4
Viene de: la parte de fuentes independientes del ticket 05 original (D6)

## Qué

Contrastar cada receta nueva con fuentes que no compartan los errores del modelo principal: una
segunda lectura, una receta española publicada con pesos (Perplexity Sonar con búsqueda web) y un
juez de otra familia solo cuando no coinciden.

## Por qué (y por qué ahora es condicional)

- Tres lecturas del mismo modelo se equivocan igual. Una receta publicada no.
- Pero la auditoría (H24, D7) mostró que el error dominante era la **cantidad**, y esa la pone el
  código desde los tickets 14 y 08. Lo que las fuentes independientes pueden mejorar después son las
  **omisiones** (9,2 % en la línea base) y las proporciones raras.
- Si una lectura validada ya cumple, esto es gasto sin beneficio (memoria
  `ai-plan-quality-cheap-model`: la variante más barata que cumpla).

## Condición de entrada

Se pasa `bun run eval:recipes` tras el 08. Este ticket se desbloquea si se cumple **alguna** de
estas:

- ingredientes principales omitidos > 1 %;
- densidad > 6 %;
- proteína por ración > 8 %;
- reparto de macros > 3 pts.

Si no se cumple ninguna, se cierra como "no hace falta", con los números en Comments.

## Diseño (el del 05 original, sin cambios de fondo)

- **Lecturas:**
  - A: el `DISH_MODEL` elegido en el 05.
  - B: el mismo con otra redacción del prompt, o un modelo barato de otra familia.
  - S: `perplexity/sonar`, que busca 2-3 recetas españolas publicadas con pesos y devuelve sus URLs.
    Se normaliza a 1 ración base. Si su masa se aleja más del 40 % de la mediana de A y B, se
    reescala conservando sus proporciones.
- **Conciliación en código** — `reconcile(readings)`, puro:
  - Presencia: un ingrediente entra si está en ≥ 2 de las 3 lecturas.
  - Gramos: la mediana de las lecturas que lo tienen.
  - Hay desacuerdo si:
    - un ingrediente de ≥ 50 kcal está en una sola lectura;
    - la densidad difiere > 12 % entre lecturas;
    - el reparto de macros difiere > 5 pts;
    - el aceite difiere > 60 kcal.
- **Juez** (solo con desacuerdo): `openai/gpt-5-mini` o `deepseek/deepseek-v3.2`. Sus gramos se
  recortan al rango `[mín, máx]` de las lecturas, y no puede añadir un ingrediente que ninguna
  lectura tenía.
- `dish_recipes` ya tiene las columnas `agreement`, `judged` y `sources` (06). Se rellenan aquí.
- A/B obligatorio: `A+B` · `A+B+S` · `A+B+S+juez`. Se adopta la más barata que cumpla.
- Coste estimado: ≈ 0,01-0,015 $ por plato nuevo, una vez para toda la app.

## Archivos

- `src/lib/nutrition/sources/*.server.ts`, `src/lib/nutrition/reconcile.ts` + test
- `src/lib/ai-provider.server.ts` (constantes de modelo)

## Criterios de aceptación

- [ ] La variante elegida cumple los objetivos del spec que motivaron abrir el ticket.
- [ ] El juez nunca da gramos fuera del rango de las lecturas (test).
- [ ] Una respuesta inválida de Sonar cuenta como lectura ausente (test).
- [ ] Coste medido por plato nuevo ≤ 0,02 $, apuntado en Comments.

## Comments
