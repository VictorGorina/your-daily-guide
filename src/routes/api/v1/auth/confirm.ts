import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { requestSignupConfirmation } from "@/lib/auth.functions";

// Espejo HTTP para la app nativa. Como /api/v1/auth/reset, va sin sesión: se
// pide justo cuando todavía no hay cuenta con la que autenticarse.
export const Route = createFileRoute("/api/v1/auth/confirm")({
  server: { handlers: { POST: apiPost(requestSignupConfirmation) } },
});
