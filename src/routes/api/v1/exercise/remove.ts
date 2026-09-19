import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { removeExercise } from "@/lib/exercise.functions";

export const Route = createFileRoute("/api/v1/exercise/remove")({
  server: { handlers: { POST: apiPost(removeExercise) } },
});
