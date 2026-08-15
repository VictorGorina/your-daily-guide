import { createFileRoute } from "@tanstack/react-router";

import { generateDailyGuide } from "@/lib/guide.functions";
import { apiPost } from "@/lib/api-route.server";

export const Route = createFileRoute("/api/v1/guide")({
  server: { handlers: { POST: apiPost(generateDailyGuide) } },
});
