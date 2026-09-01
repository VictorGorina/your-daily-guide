import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { setChildMeal } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/child-meal")({
  server: { handlers: { POST: apiPost(setChildMeal) } },
});
