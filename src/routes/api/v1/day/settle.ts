import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { settleDay } from "@/lib/day-settle.functions";

export const Route = createFileRoute("/api/v1/day/settle")({
  server: { handlers: { POST: apiPost(settleDay) } },
});
