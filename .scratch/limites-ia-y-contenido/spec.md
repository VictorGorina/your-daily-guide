# Límites de la IA y del contenido que escribe la persona

Status: implementado (2026-09-21)

## Problema

Dos agujeros que se pedían cerrar a la vez:

1. **La IA contestaba de todo.** Se le podía pedir código, tareas del cole o que actuara como
   otro asistente, y contestaba. Peor: la herramienta `actualizar_perfil` del chat deja escribir
   campos de texto libre (`life_context`, `restrictions`…) que `coachSystemPrompt` interpolaba
   en crudo — así que alguien podía guardar "ignora tus instrucciones" y quedaba inyectado en el
   system prompt de TODAS las superficies (chat, guía, plan, briefing, repaso) para siempre.
2. **Cualquier texto se guardaba como comida.** Un plato llamado "caca" quedaba en
   `monthly_plans.plan`, se veía todo el mes en Hoy y en el calendario, se espejaba al resto del
   hogar con `syncSharedMeals` y volvía a entrar en los prompts.

## Decisiones

- **Alcance amplio, no "solo platos".** Dentro del tema: comida y lo que la rodea (horarios,
  ejercicio, ánimo, sueño, presupuesto) cuando sirve para explicar o ajustar la alimentación. Un
  alcance estricto habría contradicho lo que el onboarding ya promete con `coach_scope`.
- **El filtro cubre comida + nombres y hábitos**, no solo los platos.
- **Corte determinista antes de gastar la llamada**, no solo regla de prompt.
- **El servidor es la frontera; el cliente solo da el aviso rápido.** Gracias a `apiPost`, un
  `.validator()` cubre web, móvil y las herramientas del coach a la vez.
- **Ante la duda, se deja pasar.** Un falso positivo le impide a alguien apuntar lo que de verdad
  ha comido; eso es peor que colar una broma, que además caza la segunda red.

## Forma de la solución

Dos redes por cada límite, ninguna de ellas suficiente sola:

| Límite | Red barata (coste cero) | Red semántica |
| --- | --- | --- |
| Fuera de tema | `coach-scope.ts` antes de la llamada | regla de alcance en `coachSystemPrompt` |
| No es comida | `content-guard.ts` en los validadores | campo `comida`/`isFood` del modelo |

## Lo que queda fuera

- Trigger de Postgres para los nombres: hoy `addChild`/`updateMember`/`saveProfile` escriben del
  navegador directo a Supabase, así que ahí el guard avisa pero no es frontera (ver issue 01).
- Datos ya guardados: no hay migración.
- Contar intentos repetidos y limitar a quien insiste.
