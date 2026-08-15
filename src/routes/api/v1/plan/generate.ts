import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { generateMonthlyPlan } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/generate")({
  server: { handlers: { POST: apiPost(generateMonthlyPlan) } },
});
