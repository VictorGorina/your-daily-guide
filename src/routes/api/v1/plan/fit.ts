import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { fitMonthlyPlan } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/fit")({
  server: { handlers: { POST: apiPost(fitMonthlyPlan) } },
});
