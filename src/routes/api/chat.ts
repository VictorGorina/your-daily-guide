import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import { COACH_MODEL, coachSystemPrompt, createAiProvider } from "@/lib/ai-provider.server";
import { supabaseFromRequest, unauthorized } from "@/lib/api-auth.server";
import { describeSharedSlots } from "@/lib/household-shared";
import { householdContext, type HouseholdContext } from "@/lib/household.server";
import { addDays, weekdayName } from "@/lib/plan-shared";
import { CHAT_EDITABLE_PROFILE_FIELDS } from "@/lib/profile-fields";
import { zonedTodayISO } from "@/lib/zoned-date";

/**
 * Reglas para el coach sobre quién puede tocar qué del plan del hogar, solo
 * cuando `actions` está activo (van con las herramientas). Los guards del
 * servidor ya bloquean lo que no toca; esto evita que el coach prometa un
 * cambio que luego no puede aplicar.
 */
function householdCoachRules(home: HouseholdContext, userId: string): string {
  if (!home.householdId) return "";
  const plannerName =
    home.members.find((m) => m.userId === home.plannerId)?.displayName ?? "quien lleva la cocina";
  const myName = home.members.find((m) => m.userId === userId)?.displayName ?? "esta persona";
  const isPlanner = !home.plannerId || home.plannerId === userId;
  const kids = home.children;

  if (isPlanner) {
    if (!kids.length) return "";
    return (
      `\nNiños de la casa: ${kids
        .map((c) => `${c.name}${c.allergies ? ` (alergia a ${c.allergies})` : ""}`)
        .join(", ")}. ` +
      "Si la persona quiere otro plato para un NIÑO concreto un día (su alérgeno, no le gusta, o pide otra cosa para él), usa cambiar_plato_nino con el nombre del niño — no cambiar_plato, que cambia el plato de toda la mesa. Deja 'plato' vacío para que el niño vuelva a comer lo compartido."
    );
  }

  return (
    `\nQuien te habla es ${myName}, que NO planifica en su casa. Las comidas compartidas (${describeSharedSlots(home.sharedSlots)}) las decide ${plannerName}${kids.length ? ", igual que el plato aparte de los niños" : ""}. Con ${myName}:` +
    `\n- Para una comida compartida: NO llames a cambiar_plato ni a cambiar_plato_nino (la herramienta lo rechaza) y NUNCA ofrezcas cambiarla "para toda la mesa". Dile que ese plato lo lleva ${plannerName}; puede registrar lo que coma de verdad ese día como su comida real (queda privado) o hablarlo con ${plannerName}.` +
    `\n- Sus comidas EN SOLITARIO (las de días u horas que no comparte, y el snack) sí son suyas: esas sí puedes cambiarlas con cambiar_plato o recolocarlas con ajustar_plan_mensual.`
  );
}

// Mismo catálogo de campos que la pantalla "Mis respuestas" en Ajustes, para
// que lo que se pueda corregir por chat sea exactamente lo mismo que se
// puede corregir a mano — un único sitio de verdad para ambos canales.
const actualizarPerfilShape = Object.fromEntries(
  CHAT_EDITABLE_PROFILE_FIELDS.map((f) => [
    f.key,
    (f.kind === "number" ? z.number() : z.string())
      .nullable()
      .optional()
      .describe(f.help ? `${f.label} (${f.help})` : f.label),
  ]),
) as Record<string, z.ZodTypeAny>;

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
  cambiar_plato: tool({
    description:
      "Cambia un plato concreto del plan (desayuno, comida, cena o snack) de un día concreto, de hoy en adelante. Úsala SIEMPRE que la persona pida cambiar, sustituir o elegir otro plato para un día: decir que sí en el chat no cambia nada, el plan solo se actualiza si llamas a esta herramienta. Úsala también cuando el plato lleve ingredientes que no están en la lista de la compra — se guarda igual y te devuelve cuáles faltan para que puedas avisar. Para un solo plato usa esta, no ajustar_plan_mensual.",
    inputSchema: z.object({
      fecha: z.string().describe("Día que se cambia, en formato YYYY-MM-DD. Hoy o posterior"),
      comida: z
        .enum(["desayuno", "comida", "cena", "snack"])
        .describe("Qué comida de ese día se cambia"),
      plato: z.string().describe("El plato nuevo, concreto y corto, sin gramajes"),
    }),
  }),
  cambiar_plato_nino: tool({
    description:
      "Cambia (o quita) el plato aparte de un NIÑO de la casa para un día concreto, de hoy en adelante, cuando el plato compartido no le sirve o la persona pide otra cosa para ese niño. Solo la puede usar quien planifica en casa. Deja 'plato' vacío para que el niño vuelva a comer el plato compartido. Como cambiar_plato: decir que sí en el chat no cambia nada, hay que llamar a la herramienta.",
    inputSchema: z.object({
      fecha: z.string().describe("Día que se cambia, en formato YYYY-MM-DD. Hoy o posterior"),
      comida: z
        .enum(["desayuno", "comida", "cena"])
        .describe("Qué comida de ese día lleva el niño aparte"),
      nino: z.string().describe("Nombre del niño tal y como aparece en la casa"),
      plato: z
        .string()
        .describe("El plato aparte para el niño, corto y sin gramajes. Vacío para quitarlo"),
    }),
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
  actualizar_perfil: tool({
    description:
      "Actualiza uno o varios datos del perfil (los mismos campos editables en Ajustes > Mis respuestas: horarios, restricciones o alergias, presupuesto mensual, tono, objetivo, nivel de actividad, etc.) cuando la persona cuenta un cambio real y explícito sobre sí misma. Incluye solo los campos que cambian; no inventes ni asumas datos que no te ha dado, y no la uses para peso de hoy ni para la fecha objetivo (esas tienen su propia herramienta).",
    inputSchema: z.object(actualizarPerfilShape),
  }),
} as const;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await supabaseFromRequest(request);
        if (!auth) return unauthorized();
        const { userId, supabase } = auth;

        const body = (await request.json()) as {
          messages?: UIMessage[];

          profile?: Record<string, unknown> | null;
          guide?: unknown;
          log?: unknown;
          actions?: boolean;
          today?: string;
          compra?: { confirmada: boolean; ingredientes: string[] } | null;
          despensa_extra?: string[];
          proximos?: Record<string, string>[];
        };
        if (!Array.isArray(body.messages)) {
          return new Response("Faltan mensajes", { status: 400 });
        }
        const key = process.env.OPENROUTER_API_KEY;
        if (!key) return new Response("Falta OPENROUTER_API_KEY", { status: 500 });

        const ai = createAiProvider(key);
        // La fecha se dice explícita (y con el día de la semana) porque el
        // modelo no la sabe: sin esto, "el desayuno de mañana" no se puede
        // convertir en la fecha que necesita cambiar_plato.
        const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? "")
          ? body.today!
          : zonedTodayISO((body.profile as { timezone?: string } | null)?.timezone ?? undefined);
        const tomorrow = addDays(today, 1);

        // Contexto del hogar (mesa, comidas compartidas, niños y quién
        // planifica): lo mismo que reciben `generateMonthlyPlan` /
        // `adjustMonthlyPlan`, para que el coach hable del plan de la casa con
        // propiedad y sepa cuándo un cambio no es de esta persona.
        const home = await householdContext(supabase as never, userId);

        const system =
          coachSystemPrompt(body.profile as never, home.householdId ? home.text : null) +
          `\nHoy es ${today} (${weekdayName(today)}). Mañana es ${tomorrow} (${weekdayName(tomorrow)}).` +
          (body.actions ? householdCoachRules(home, userId) : "") +
          (body.compra
            ? `\nIngredientes que ya tiene comprados este mes: ${body.compra.ingredientes.join(", ") || "sin lista"}.` +
              (body.compra.confirmada
                ? " La compra está confirmada: no se puede añadir nada a la lista."
                : " La compra aún no está confirmada.")
            : "") +
          (body.despensa_extra?.length
            ? `\nAdemás dice tener en casa (fuera de la lista de la compra, no lo añadas a la lista pero puedes proponer platos con ello): ${body.despensa_extra.join(", ")}.`
            : "") +
          (body.proximos?.length
            ? `\nMenú de los próximos días: ${JSON.stringify(body.proximos)}`
            : "") +
          (body.guide ? `\nGuía de hoy ya enviada: ${JSON.stringify(body.guide)}` : "") +
          (body.log
            ? `\nLo que ha pasado hoy de verdad (peso, hábitos, notas): ${JSON.stringify(body.log)}`
            : "") +
          (body.actions
            ? "\nPuedes cambiar lo que la persona ve en pantalla con tus herramientas (peso, hábitos, guía del día, platos sueltos del plan, reajuste del plan mensual, recálculo del objetivo, fecha objetivo y el resto del perfil)." +
              "\nCambiar un plato: en cuanto sepas qué quiere comer y qué día (hoy o futuro), llama a cambiar_plato con la fecha exacta antes de contestarle. Decirlo en el chat no cambia nada: si no llamas a la herramienta, el plan se queda igual y la persona se encuentra el plato viejo en la app. No pidas una confirmación de más cuando ya te ha dicho el plato que quiere. Solo pregunta antes si NO te ha dicho qué le apetece: entonces propón 1 o 2 platos y aplica el que elija. Los días ya pasados no se pueden cambiar: dilo sin darle importancia." +
              "\nPlato de un niño: si lo que quiere cambiar es lo que come un NIÑO concreto de la casa un día (porque el plato compartido lleva su alérgeno, no le gusta, o pide otra cosa para él), usa cambiar_plato_nino con el nombre del niño — no cambiar_plato, que es para toda la mesa. (Si arriba se dice que quien te habla no planifica en su casa, esto no es cosa suya: sigue esa regla.)" +
              "\nIngredientes fuera de la compra: cuando propongas tú, usa solo lo que ya tiene comprado — es la gracia de haber hecho la compra. Pero que un plato lleve algo que no está en la lista NO es motivo para no cambiarlo: llama igualmente a cambiar_plato y luego dile en una frase qué tendría que comprar aparte (la herramienta te devuelve exactamente qué falta). Cambiar el plato y avisar van juntos, nunca avises sin cambiar. No añadas nada a la lista de la compra." +
              "\nEl plan es vivo: cada vez que la persona cuente algo que cambia su balance de energía o su ritmo (ha comido de más, se ha saltado una comida, ha salido a correr, ha entrenado, ha tenido una semana floja), haz DOS cosas: 1) llama a ajustar_plan_mensual con el motivo y una estimación de kcal_extra para recolocar sólo los días futuros con los ingredientes ya comprados; 2) llama a recalcular_objetivo para explicarle el impacto en su objetivo y ofrecerle acortar el plazo o ser algo más laxo. Para esa recolocación automática el día de hoy está fijado: compensa siempre en los días siguientes. (Distinto es que te pida a mano otro plato para hoy: eso sí se cambia, con cambiar_plato.)" +
              "\nQué comió de verdad hoy: si te dice qué comió en una comida CONCRETA de HOY (desayuno, comida, cena o snack) en vez de lo planeado — aunque lo cuente en pasado, tipo 'en la cena he comido una hamburguesa en vez de la sopa' — llama TAMBIÉN a cambiar_plato con fecha de hoy y esa comida, poniendo el plato que de verdad comió: así la pantalla de Hoy deja de enseñar el plato viejo y las macros del día se recalculan con el real. Esto va ADEMÁS de (no en vez de) ajustar_plan_mensual y recalcular_objetivo por el exceso — las tres herramientas encajan: cambiar_plato corrige lo que se ve hoy, las otras dos compensan los días futuros y el objetivo. Solo se queda 'fijado' el día de hoy cuando NO te ha dicho qué comió en una comida concreta (p. ej. 'he picoteado entre horas' sin más detalle, o hablando en general de la semana)." +
              "\nSi acepta cambiar el plazo, usa cambiar_fecha_objetivo." +
              "\nSi te cuenta un cambio real y explícito sobre sí misma que no es el peso de hoy ni la fecha objetivo — nuevas restricciones o alergias, presupuesto, horarios, nivel de actividad, tono que prefiere, tipo de objetivo, etc. — usa actualizar_perfil con solo esos campos. No la llames ante una duda, un comentario de pasada o algo que no ha confirmado del todo. Si el cambio afecta al plan del mes (presupuesto, restricciones, tipo de alimentación, objetivo) y el plan de este mes ya está confirmado/comprado, dile que se aplicará al generar el plan del próximo mes; si no está confirmado, ofrécele regenerarlo desde la pestaña Plan." +
              "\nDespués de cualquier cambio, confirma en una o dos frases qué has actualizado, sin culpar y sin presionar, para que pueda corregirlo ahí mismo si no era eso."
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
