import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { logExercise } from "@/lib/exercise.functions";

export const Route = createFileRoute("/api/v1/exercise/log")({
  server: { handlers: { POST: apiPost(logExercise) } },
});
