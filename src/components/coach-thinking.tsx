"use client";

import { Message, MessageContent } from "@/components/ai-elements/message";

export function CoachThinking() {
  return (
    <Message from="assistant">
      <MessageContent className="relative min-w-[8rem] overflow-hidden rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-foreground shadow-sm">
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="h-20 w-20 rounded-full bg-primary/10 animate-coach-pulse" />
          <span className="absolute h-14 w-14 rounded-full bg-primary/15 animate-coach-pulse [animation-delay:0.6s]" />
        </span>

        <span className="relative z-10 flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-primary animate-coach-dot" />
            <span className="h-2 w-2 rounded-full bg-primary/70 animate-coach-dot [animation-delay:0.15s]" />
            <span className="h-2 w-2 rounded-full bg-primary/50 animate-coach-dot [animation-delay:0.3s]" />
          </span>
          <span className="text-xs font-medium italic text-muted-foreground">Pensando...</span>
        </span>
      </MessageContent>
    </Message>
  );
}
