import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { setPantryExtra } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/pantry-extra")({
  server: { handlers: { POST: apiPost(setPantryExtra) } },
});
