import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { welcomeBriefing } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/welcome")({
  server: { handlers: { POST: apiPost(welcomeBriefing) } },
});
