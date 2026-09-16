import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { removeSnack } from "@/lib/snacks.functions";

export const Route = createFileRoute("/api/v1/snacks/remove")({
  server: { handlers: { POST: apiPost(removeSnack) } },
});
