import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { propagateLogToFamily } from "@/lib/household.functions";

export const Route = createFileRoute("/api/v1/household/propagate-log")({
  server: { handlers: { POST: apiPost(propagateLogToFamily) } },
});
