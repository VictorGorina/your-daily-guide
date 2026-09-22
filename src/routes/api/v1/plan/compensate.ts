import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { settleDay } from "@/lib/day-settle.functions";

/**
 * Alias histórico de `POST /api/v1/day/settle` (feature `balance-del-dia`): un
 * cambio de plato de hoy ya no se compensa por su cuenta, se asienta el día
 * entero. Acepta el mismo `{today, changes}`, así que las builds móviles ya
 * instaladas siguen funcionando — y de paso pasan a decidir con el día
 * completo. Solo cambia la forma de la respuesta (`outcome` en vez de
 * `adjusted`), y una build vieja que lea `adjusted` simplemente no pinta la
 * frase de "he ajustado N comidas": el plan se recoloca igual.
 */
export const Route = createFileRoute("/api/v1/plan/compensate")({
  server: { handlers: { POST: apiPost(settleDay) } },
});
