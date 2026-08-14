import { useChat } from "@ai-sdk/react";

import { authHeaders } from "@/lib/auth-headers";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { useEffect, useMemo, useRef } from "react";

import { BottomNav } from "@/components/bottom-nav";
import { ChatHistorySheet } from "@/components/chat-history-sheet";
import { CoachThinking } from "@/components/coach-thinking";
import { DictateButton } from "@/components/dictate-button";
import { GuidedLogSheet } from "@/components/guided-log-sheet";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { addMessage, ensureTodayLog, fetchMessages, fetchProfile, todayISO } from "@/lib/daily";
import { useCoachActions } from "@/lib/use-coach-actions";

export const Route = createFileRoute("/_authenticated/chat")({
  component: ChatPage,
});

const QUICK_PROMPTS = [
  "Ya he desayunado 🥣",
  "He comido fuera de casa",
  "Me he saltado el plan",
  "He salido a correr 🏃",
  "Hoy tengo mucha hambre",
  "Me siento sin energía",
  "Ajusta el plan de mañana",
  "¿Qué ceno hoy?",
];

function ChatPage() {
  const date = todayISO();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const todayQ = useQuery({ queryKey: ["today"], queryFn: () => ensureTodayLog([]) });
  const historyQ = useQuery({ queryKey: ["messages", date], queryFn: () => fetchMessages(date) });

  const ctx = useRef({ profile: profileQ.data, guide: todayQ.data?.guide, log: todayQ.data });
  ctx.current = { profile: profileQ.data, guide: todayQ.data?.guide, log: todayQ.data };
  const { runTool, refresh } = useCoachActions(() => ctx.current.log);

  const initial = useMemo<UIMessage[]>(
    () =>
      (historyQ.data ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        parts: [{ type: "text" as const, text: m.content }],
      })),
    [historyQ.data],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: async ({ messages }) => ({
          headers: await authHeaders(),
          body: {
            messages,
            profile: ctx.current.profile,
            guide: ctx.current.guide,
            actions: true,
            log: ctx.current.log
              ? {
                  fecha: ctx.current.log.log_date,
                  peso: ctx.current.log.weight_kg,
                  habitos: ctx.current.log.habits,
                  notas: ctx.current.log.notes,
                }
              : null,
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, setMessages, status, error, addToolResult } = useChat({
    id: date,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      const { toolCallId, toolName, input } = toolCall as unknown as {
        toolCallId: string;
        toolName: string;
        input: unknown;
      };
      try {
        const output = await runTool(toolName, (input ?? {}) as Record<string, unknown>);
        refresh();
        addToolResult({ tool: toolName as never, toolCallId, output });
      } catch {
        addToolResult({
          tool: toolName as never,
          toolCallId,
          output: "No se ha podido aplicar el cambio",
        });
      }
    },
    onFinish: ({ message }) => {
      const text = message.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("")
        .trim();
      if (text) void addMessage("assistant", text);
    },
  });

  useEffect(() => {
    if (historyQ.isSuccess && messages.length === 0 && initial.length > 0) setMessages(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQ.isSuccess, initial]);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy]);

  const appendDictation = (text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const next = el.value ? `${el.value.trim()} ${text}` : text;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };

  const handleSubmit = (message: { text?: string }) => {
    const text = message.text?.trim();
    if (!text || busy) return;
    void addMessage("user", text);
    void sendMessage({ text });
  };

  const sendQuick = (text: string) => {
    if (busy) return;
    void addMessage("user", text);
    void sendMessage({ text });
  };

  return (
    <main className="mx-auto flex h-[100dvh] max-w-lg flex-col px-4 pb-24 pt-10">
      <header className="flex items-end justify-between px-1 pb-3">
        <div>
          <h1 className="font-display text-2xl">Tu coach</h1>
          <p className="text-xs text-muted-foreground">
            Conversación de hoy · {new Date().toLocaleDateString("es-ES", { dateStyle: "long" })}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <GuidedLogSheet onSend={sendQuick} disabled={busy} />
          <ChatHistorySheet />
        </div>
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-4 px-0">
          {messages.length === 0 ? (
            <ConversationEmptyState
              title="Cuéntame cómo va tu día"
              description="Qué has comido, cómo te sientes o qué te cuesta hoy."
            />
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent
                  className={
                    m.role === "assistant"
                      ? "bg-transparent p-0 text-foreground"
                      : "bg-primary text-primary-foreground"
                  }
                >
                  <MessageResponse>
                    {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
                  </MessageResponse>
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" ? <CoachThinking /> : null}
          {error ? (
            <p className="text-sm text-destructive">
              El coach no ha podido responder. Inténtalo de nuevo en un momento.
            </p>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {QUICK_PROMPTS.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => sendQuick(q)}
            className="shrink-0 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <PromptInput onSubmit={handleSubmit} className="mt-2">
        <PromptInputTextarea ref={textareaRef} placeholder="Escribe a tu coach..." />
        <PromptInputFooter className="justify-between">
          <DictateButton onText={appendDictation} label="Dictar" />
          <PromptInputSubmit status={status} disabled={busy} />
        </PromptInputFooter>
      </PromptInput>

      <BottomNav />
    </main>
  );
}
