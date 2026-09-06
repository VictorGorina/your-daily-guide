import { createFileRoute } from "@tanstack/react-router";

import { AuthFlow } from "@/components/auth-flow";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Peppers — Tu asistente de alimentación con IA" },
      {
        name: "description",
        content:
          "Come mejor cada día, sin complicaciones: guía matutina, repaso nocturno y un objetivo medible con progreso visual. Sin dietas rígidas.",
      },
      { property: "og:title", content: "Peppers — Tu asistente de alimentación con IA" },
      {
        property: "og:description",
        content: "Hábitos, no restricciones. Un asistente que te acompaña cada día.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return <AuthFlow initialStage="intro" />;
}
