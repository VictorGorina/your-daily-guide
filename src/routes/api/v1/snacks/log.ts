import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { logSnack } from "@/lib/snacks.functions";

export const Route = createFileRoute("/api/v1/snacks/log")({
  server: { handlers: { POST: apiPost(logSnack) } },
});
