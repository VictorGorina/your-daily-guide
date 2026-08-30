import { createFileRoute } from "@tanstack/react-router";

import { apiPost } from "@/lib/api-route.server";
import { requestPasswordReset } from "@/lib/auth.functions";

// Espejo HTTP para la app nativa. A diferencia del resto de /api/v1/*, esta ruta
// no lleva sesión: quien ha perdido la contraseña no puede autenticarse.
export const Route = createFileRoute("/api/v1/auth/reset")({
  server: { handlers: { POST: apiPost(requestPasswordReset) } },
});
