import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { setTripActual } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/trip-actual")({
  server: { handlers: { POST: apiPost(setTripActual) } },
});
