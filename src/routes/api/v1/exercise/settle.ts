import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { settleDay } from "@/lib/day-settle.functions";

/**
 * Alias histórico de `POST /api/v1/day/settle` (feature `balance-del-dia`), por
 * el mismo motivo que `snacks/settle.ts`: las builds móviles ya instaladas
 * siguen llamando aquí.
 */
export const Route = createFileRoute("/api/v1/exercise/settle")({
  server: { handlers: { POST: apiPost(settleDay) } },
});
