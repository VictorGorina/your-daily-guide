import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { toggleShoppingOwned } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/shopping-owned")({
  server: { handlers: { POST: apiPost(toggleShoppingOwned) } },
});
