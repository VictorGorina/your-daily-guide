import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { saveHomeSchedule } from "@/lib/household.functions";

export const Route = createFileRoute("/api/v1/household/home-schedule")({
  server: { handlers: { POST: apiPost(saveHomeSchedule) } },
});
