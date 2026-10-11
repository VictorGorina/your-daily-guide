import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { saveDayGuide } from "@/lib/day-guide.functions";

export const Route = createFileRoute("/api/v1/day/guide")({
  server: { handlers: { POST: apiPost(saveDayGuide) } },
});
