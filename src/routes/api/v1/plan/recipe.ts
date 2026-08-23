import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { dishRecipe } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/recipe")({
  server: { handlers: { POST: apiPost(dishRecipe) } },
});
