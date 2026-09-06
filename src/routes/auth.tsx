import { createFileRoute } from "@tanstack/react-router";

import { AuthFlow } from "@/components/auth-flow";
import { safeInternalPath } from "@/lib/safe-next";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: safeInternalPath(search.next as string | undefined),
  }),
  head: () => ({
    meta: [
      { title: "Entrar en Peppers" },
      { name: "description", content: "Accede a tu asistente de alimentación con IA." },
      { property: "og:title", content: "Entrar en Peppers" },
      { property: "og:description", content: "Accede a tu asistente de alimentación con IA." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { next } = Route.useSearch();
  return <AuthFlow initialStage="access" next={next} />;
}
