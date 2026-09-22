import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { settleDay } from "@/lib/day-settle.functions";

/**
 * Alias histórico de `POST /api/v1/day/settle` (feature `balance-del-dia`): el
 * picoteo ya no se asienta por su cuenta, se asienta el día entero. Se mantiene
 * por las versiones de la app móvil que ya están instaladas y siguen llamando
 * aquí; una build vieja sigue compensando, solo que ahora con el día completo.
 */
export const Route = createFileRoute("/api/v1/snacks/settle")({
  server: { handlers: { POST: apiPost(settleDay) } },
});
