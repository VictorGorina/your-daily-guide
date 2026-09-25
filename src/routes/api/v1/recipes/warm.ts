import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { warmRecipes } from "@/lib/recipes.functions";

export const Route = createFileRoute("/api/v1/recipes/warm")({
  server: { handlers: { POST: apiPost(warmRecipes) } },
});
