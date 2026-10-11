import type { Json } from "@/integrations/supabase/types";
import { updateDailyLogCas, type DailyLogPatch } from "@/lib/daily-rows.server";
import type { DayGuideInput } from "@/lib/day-guide";

/**
 * Cuerpo de `saveDayGuide`, aparte para poder probarlo. Escribe la guía (y, si
 * vienen, las comidas) en la fila de ESE día de quien llama; `userId` es el del
 * JWT. Nunca crea la fila: la guía se genera sobre un día que ya existe.
 *
 * El patch no depende de lo leído, igual que el `update` que hacía el cliente:
 * lo que cambia es quién escribe, no qué gana si dos escrituras se cruzan.
 */
export async function saveDayGuideHandler({
  data,
  context,
}: {
  data: DayGuideInput;
  context: { userId: string };
}): Promise<{ saved: boolean }> {
  const patch: DailyLogPatch = { guide: data.guide as unknown as Json };
  if (data.habits) patch.habits = data.habits as unknown as Json;
  const { patch: written } = await updateDailyLogCas(context.userId, data.date, "id", () => patch, {
    exhaustedMessage: "No hemos podido guardar la guía del día. Inténtalo de nuevo.",
  });
  return { saved: written !== null };
}
