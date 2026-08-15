import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { adjustMonthlyPlan } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/adjust")({
  server: { handlers: { POST: apiPost(adjustMonthlyPlan) } },
});
