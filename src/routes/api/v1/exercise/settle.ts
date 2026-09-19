import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { settleExercise } from "@/lib/exercise.functions";

export const Route = createFileRoute("/api/v1/exercise/settle")({
  server: { handlers: { POST: apiPost(settleExercise) } },
});
