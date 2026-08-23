import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { recadenceMonthlyPlan } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/recadence")({
  server: { handlers: { POST: apiPost(recadenceMonthlyPlan) } },
});
