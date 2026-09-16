import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { settleSnacks } from "@/lib/snacks.functions";

export const Route = createFileRoute("/api/v1/snacks/settle")({
  server: { handlers: { POST: apiPost(settleSnacks) } },
});
