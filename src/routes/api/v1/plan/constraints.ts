import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { setMonthConstraints } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/constraints")({
  server: { handlers: { POST: apiPost(setMonthConstraints) } },
});
