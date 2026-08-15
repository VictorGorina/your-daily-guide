import { createFileRoute } from "@tanstack/react-router";

import { deleteAccount } from "@/lib/account.functions";
import { apiPost } from "@/lib/api-route.server";

export const Route = createFileRoute("/api/v1/account/delete")({
  server: { handlers: { POST: apiPost(deleteAccount) } },
});
