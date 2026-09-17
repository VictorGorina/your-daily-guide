import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { compensateDishChanges } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/compensate")({
  server: { handlers: { POST: apiPost(compensateDishChanges) } },
});
