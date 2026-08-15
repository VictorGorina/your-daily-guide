import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { parseOnboarding } from "@/lib/onboarding.functions";

export const Route = createFileRoute("/api/v1/onboarding/parse")({
  server: { handlers: { POST: apiPost(parseOnboarding) } },
});
