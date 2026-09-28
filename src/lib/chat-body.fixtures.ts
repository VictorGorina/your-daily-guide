/**
 * Cuerpos reales de `/api/chat` capturados en el preview con el perfil demo el
 * 2026-09-28 (ticket 08), con los datos personales cambiados por texto de
 * relleno. Solo los importan los tests.
 */

const CONTEXT = {
  profile: { display_name: "Nombre", timezone: "Europe/Madrid", locale: "es" },
  guide: null,
  actions: true,
  today: "2026-09-28",
  compra: { confirmada: true, ingredientes: ["garbanzos", "espinacas", "huevos", "pan integral"] },
  despensa_extra: [],
  proximos: [
    {
      fecha: "2026-09-28",
      dia: "lunes",
      comida: "Garbanzos guisados con espinacas y huevo duro · Pan integral · Pera",
      cena: "Lentejas estofadas con verduras (sobras) · Pan integral · Plátano",
    },
  ],
  log: { fecha: "2026-09-28", peso: null, habitos: [], notas: null },
};

/** Web, primer mensaje de la conversación (FAB y `/chat` mandan lo mismo). */
export const WEB_FIRST_MESSAGE = {
  messages: [
    {
      parts: [{ type: "text", text: "Hoy he salido a correr 30 minutos a buen ritmo" }],
      id: "GgAbAV7CNVik24R3",
      role: "user",
    },
  ],
  ...CONTEXT,
};

/** Web, reenvío automático después de que el cliente ejecuta una herramienta. */
export const WEB_AFTER_TOOL = {
  messages: [
    WEB_FIRST_MESSAGE.messages[0],
    {
      id: "JJdxk7osra6gg5Mw",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "text",
          text: "¡Genial! Me alegro de que hayas salido a correr.\n\n",
          state: "done",
        },
        {
          type: "tool-registrar_deporte",
          toolCallId: "tool_registrar_deporte_9e2zS0FcnKVNYKSBIhA3",
          state: "output-available",
          input: { actividad: "Correr", minutos: 30, intensidad: "Normal" },
          output: "Deporte apuntado en el día de hoy: correr 30 min, intensidad normal.",
          callProviderMetadata: { openrouter: { reasoning_details: [] } },
        },
      ],
    },
  ],
  ...CONTEXT,
};

/**
 * Móvil (misma forma que la web, `mobile/app/(app)/chat.tsx`), con el acuse del
 * registro guiado: el mensaje lleva `metadata.logged` (`day-log-ack.ts`).
 */
export const MOBILE_LOGGED_ACK = {
  messages: [
    {
      id: "m-hist-1",
      role: "assistant",
      parts: [{ type: "text", text: "¡Buenos días! ¿Qué tal ha ido la mañana?" }],
    },
    {
      id: "m-ack-2",
      role: "user",
      parts: [{ type: "text", text: "Apuntado en mi día: picoteo, un puñado de almendras." }],
      metadata: { logged: "snack" },
    },
  ],
  ...CONTEXT,
};
