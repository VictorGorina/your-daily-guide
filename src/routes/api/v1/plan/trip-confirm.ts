import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { setTripConfirmed } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/trip-confirm")({
  server: { handlers: { POST: apiPost(setTripConfirmed) } },
});
