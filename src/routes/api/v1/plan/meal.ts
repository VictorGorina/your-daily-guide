import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { setPlanMeal } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/meal")({
  server: { handlers: { POST: apiPost(setPlanMeal) } },
});
