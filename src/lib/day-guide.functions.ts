import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cleanDayGuideInput } from "@/lib/day-guide";
import { saveDayGuideHandler } from "@/lib/day-guide.server";

/**
 * Guarda la guía de un día (ticket 39 de la auditoría): `daily_logs.guide` deja
 * de escribirse desde el cliente. `saved: false` si ese día no tiene fila.
 * Ruta espejo: `POST /api/v1/day/guide`.
 */
export const saveDayGuide = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { date?: string; today?: string; guide: unknown; habits?: unknown }) =>
    cleanDayGuideInput(input),
  )
  .handler(({ data, context }) => saveDayGuideHandler({ data, context }));
