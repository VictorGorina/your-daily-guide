import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { reflowMonthlyPlan } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/reflow")({
  server: { handlers: { POST: apiPost(reflowMonthlyPlan) } },
});
