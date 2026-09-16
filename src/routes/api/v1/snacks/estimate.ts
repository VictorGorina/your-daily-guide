import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { estimateSnack } from "@/lib/snacks.functions";

export const Route = createFileRoute("/api/v1/snacks/estimate")({
  server: { handlers: { POST: apiPost(estimateSnack) } },
});
