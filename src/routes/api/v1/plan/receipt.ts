import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { scanTripReceipt } from "@/lib/plan.functions";

export const Route = createFileRoute("/api/v1/plan/receipt")({
  server: { handlers: { POST: apiPost(scanTripReceipt) } },
});
