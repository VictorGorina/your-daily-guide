import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { fillChildMeals } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/child-meal-fill")({
  server: { handlers: { POST: apiPost(fillChildMeals) } },
});
