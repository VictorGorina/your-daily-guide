import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { saveSharedSlots } from "@/lib/household.functions";

export const Route = createFileRoute("/api/v1/household/shared-slots")({
  server: { handlers: { POST: apiPost(saveSharedSlots) } },
});
