import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { syncHouseholdPlan } from "@/lib/household.functions";

export const Route = createFileRoute("/api/v1/household/sync")({
  server: { handlers: { POST: apiPost(syncHouseholdPlan) } },
});
