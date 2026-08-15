import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { goalImpact } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/goal-impact")({
  server: { handlers: { POST: apiPost(goalImpact) } },
});
