import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { confirmMonthlyPlan } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/confirm")({
  server: { handlers: { POST: apiPost(confirmMonthlyPlan) } },
});
