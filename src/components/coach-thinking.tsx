"use client";

import { useTranslation } from "react-i18next";

import { Message, MessageContent } from "@/components/ai-elements/message";
import { LoadingDots } from "@/components/loading-dots";

export function CoachThinking() {
  const { t } = useTranslation();
  return (
    <Message from="assistant">
      <MessageContent className="relative min-w-[8rem] overflow-hidden rounded-2xl bg-surface px-4 py-3 text-foreground">
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-20 w-20 rounded-full bg-primary/10 animate-coach-pulse" />
          <span className="absolute h-14 w-14 rounded-full bg-primary/15 animate-coach-pulse [animation-delay:0.6s]" />
        </span>

        <span className="relative z-10 flex items-center gap-3">
          <LoadingDots />
          <span className="text-xs font-medium text-muted-foreground">{t("chat.thinking")}</span>
        </span>
      </MessageContent>
    </Message>
  );
}
