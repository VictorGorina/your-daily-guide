import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { compensateFutureDishChange } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/compensate-future")({
  server: { handlers: { POST: apiPost(compensateFutureDishChange) } },
});
