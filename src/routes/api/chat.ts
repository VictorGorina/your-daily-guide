import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { COACH_MODEL, coachSystemPrompt, createAiProvider } from "@/lib/ai-provider.server";
import { getRequestUserId, unauthorized } from "@/lib/api-auth.server";

const actionTools = {
  actualizar_peso: tool({
    description: "Guarda el peso de hoy en kg y actualiza el progreso visible en pantalla.",
    inputSchema: z.object({ kg: z.number().describe("Peso en kilogramos") }),
  }),
  marcar_habito: tool({
    description: "Marca o desmarca un hábito de hoy por su nombre aproximado.",
    inputSchema: z.object({ label: z.string(), done: z.boolean() }),
  }),
  anadir_habito: tool({
    description: "Añade un hábito nuevo a la lista de hoy.",
    inputSchema: z.object({ label: z.string() }),
  }),
  quitar_habito: tool({
    description: "Quita un hábito de la lista de hoy.",
    inputSchema: z.object({ label: z.string() }),
  }),
  regenerar_guia: tool({
    description:
      "Vuelve a generar la guía de hoy (platos sugeridos y consejos) teniendo en cuenta la conversación.",
    inputSchema: z.object({}),
  }),
  ajustar_plan_mensual: tool({
    description:
      "Reajusta los platos de los días FUTUROS del plan mensual cuando la persona cuenta que se ha saltado el plan, ha comido de más, ha hecho ejercicio extra o quiere cambiar comidas. El día de hoy y los anteriores quedan fijados y la lista de la compra nunca cambia: se reutilizan los ingredientes ya comprados.",
    inputSchema: z.object({
      motivo: z.string().describe("Qué ha pasado o qué quiere cambiar, en una o dos frases"),
      kcal_extra: z
        .number()
        .nullable()
        .describe(
          "Balance estimado de hoy en kcal: positivo si ha comido de más, negativo si ha gastado más (ejercicio). null si no se puede estimar",
        ),
    }),
  }),
  recalcular_objetivo: tool({
    description:
      "Calcula cómo afecta al objetivo lo que ha pasado (exceso de comida, ejercicio extra, semana floja) y propone acortar el plazo o ser algo más laxo. Úsala cuando la persona cuente algo que cambia su balance de energía o pregunte si sigue en camino.",
    inputSchema: z.object({
      motivo: z.string().describe("Lo que ha pasado, en una o dos frases"),
    }),
  }),
  cambiar_fecha_objetivo: tool({
    description:
      "Cambia la fecha objetivo del usuario. Úsala sólo cuando la persona acepta explícitamente adelantar o retrasar el plazo.",
    inputSchema: z.object({ fecha: z.string().describe("Fecha objetivo en formato YYYY-MM-DD") }),
  }),
} as const;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getRequestUserId(request);
        if (!userId) return unauthorized();

        const body = (await request.json()) as {
          messages?: UIMessage[];

          profile?: Record<string, unknown> | null;
          guide?: unknown;
          log?: unknown;
          actions?: boolean;
        };
        if (!Array.isArray(body.messages)) {
          return new Response("Faltan mensajes", { status: 400 });
        }
        const key = process.env.OPENROUTER_API_KEY;
        if (!key) return new Response("Falta OPENROUTER_API_KEY", { status: 500 });

        const ai = createAiProvider(key);
        const system =
          coachSystemPrompt(body.profile as never) +
          (body.guide ? `\nGuía de hoy ya enviada: ${JSON.stringify(body.guide)}` : "") +
          (body.log
            ? `\nLo que ha pasado hoy de verdad (peso, hábitos, notas): ${JSON.stringify(body.log)}`
            : "") +
          (body.actions
            ? "\nPuedes cambiar lo que la persona ve en pantalla con tus herramientas (peso, hábitos, guía del día, reajuste del plan mensual, recálculo del objetivo y fecha objetivo)." +
              "\nEl plan es vivo: cada vez que la persona cuente algo que cambia su balance de energía o su ritmo (ha comido de más, se ha saltado una comida, ha salido a correr, ha entrenado, ha tenido una semana floja), haz DOS cosas: 1) llama a ajustar_plan_mensual con el motivo y una estimación de kcal_extra para recolocar sólo los días futuros con los ingredientes ya comprados; 2) llama a recalcular_objetivo para explicarle el impacto en su objetivo y ofrecerle acortar el plazo o ser algo más laxo. El plan del día de hoy ya está fijado: nunca lo cambies, compensa siempre en los días siguientes." +
              "\nSi acepta cambiar el plazo, usa cambiar_fecha_objetivo. Después confirma en una o dos frases lo que has cambiado, sin culpar y sin presionar."
            : "");

        const result = streamText({
          model: ai(COACH_MODEL),
          system,
          messages: await convertToModelMessages(body.messages),
          ...(body.actions ? { tools: actionTools } : {}),
        });

        return result.toUIMessageStreamResponse({ originalMessages: body.messages });
      },
    },
  },
});
