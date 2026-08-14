import { useChat } from "@ai-sdk/react";

import { authHeaders } from "@/lib/auth-headers";
import { useQuery } from "@tanstack/react-query";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  AlertCircle,
  Check,
  Loader2,
  MessageCircle,
  Scale,
  Sparkles,
  CalendarRange,
  ListChecks,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { Shimmer } from "@/components/ai-elements/shimmer";
import { DictateButton } from "@/components/dictate-button";
import { addMessage, ensureTodayLog, fetchProfile, todayISO, type DailyLog } from "@/lib/daily";
import { useCoachActions } from "@/lib/use-coach-actions";

type ToolCall = { toolCallId: string; toolName: string; input: unknown };

type ActionState = "running" | "done" | "error";
type ActionEntry = { id: string; tool: string; state: ActionState; text: string };

const ACTION_META: Record<string, { icon: typeof Scale; running: string }> = {
  actualizar_peso: { icon: Scale, running: "Guardando tu peso..." },
  marcar_habito: { icon: ListChecks, running: "Actualizando tus hábitos..." },
  anadir_habito: { icon: ListChecks, running: "Añadiendo el hábito..." },
  quitar_habito: { icon: ListChecks, running: "Quitando el hábito..." },
  regenerar_guia: { icon: Sparkles, running: "Regenerando tu guía de hoy..." },
  ajustar_plan_mensual: { icon: CalendarRange, running: "Reajustando los días que quedan..." },
  recalcular_objetivo: { icon: Target, running: "Recalculando tu objetivo..." },
  cambiar_fecha_objetivo: { icon: Target, running: "Actualizando tu fecha objetivo..." },
};

function ActionRow({ action }: { action: ActionEntry }) {
  const Icon =
    action.state === "error" ? AlertCircle : (ACTION_META[action.tool]?.icon ?? Sparkles);
  const running = action.state === "running";
  return (
    <div
      className={`animate-toast-in flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-xs font-medium ${
        action.state === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-primary/25 bg-primary/10 text-primary"
      }`}
      aria-live="polite"
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface">
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : action.state === "done" ? (
          <Check className="animate-pop h-3.5 w-3.5" />
        ) : (
          <Icon className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="min-w-0">{action.text}</span>
    </div>
  );
}

export function CoachFab() {
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [flash, setFlash] = useState<ActionState | null>(null);
  const date = todayISO();

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const todayQ = useQuery({
    queryKey: ["today"],
    queryFn: () => ensureTodayLog([]),
    enabled: open,
  });

  const ctx = useRef<{ profile: unknown; guide: unknown; log: DailyLog | undefined }>({
    profile: undefined,
    guide: undefined,
    log: undefined,
  });
  ctx.current = {
    profile: profileQ.data,
    guide: todayQ.data?.guide,
    log: todayQ.data,
  };
  const { runTool, refresh } = useCoachActions(() => ctx.current.log);

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
            log: ctx.current.log
              ? {
                  fecha: ctx.current.log.log_date,
                  peso: ctx.current.log.weight_kg,
                  habitos: ctx.current.log.habits,
                  notas: ctx.current.log.notes,
                }
              : null,
            actions: true,
          },
        }),
      }),
    [],
  );

  const settle = useCallback((id: string, state: "done" | "error", text: string) => {
    setActions((prev) => prev.map((a) => (a.id === id ? { ...a, state, text } : a)));
    setFlash(state);
    window.setTimeout(() => setFlash(null), 2200);
    window.setTimeout(
      () => setActions((prev) => prev.filter((a) => a.id !== id || a.state === "running")),
      6000,
    );
  }, []);

  const { messages, sendMessage, status, error, addToolResult } = useChat({
    id: `fab-${date}`,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      const { toolCallId, toolName, input } = toolCall as unknown as ToolCall;
      setActions((prev) => [
        ...prev,
        {
          id: toolCallId,
          tool: toolName,
          state: "running",
          text: ACTION_META[toolName]?.running ?? "Aplicando el cambio...",
        },
      ]);
      try {
        const output = await runTool(toolName, (input ?? {}) as Record<string, unknown>);
        refresh();
        settle(toolCallId, "done", output);
        addToolResult({ tool: toolName as never, toolCallId, output });
      } catch {
        settle(toolCallId, "error", "No se ha podido aplicar el cambio");
        addToolResult({
          tool: toolName as never,
          toolCallId,
          output: "No se ha podido aplicar el cambio",
        });
      }
    },

    onFinish: ({ message }: { message: UIMessage }) => {
      const text = message.parts
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("")
        .trim();
      if (text) void addMessage("assistant", text);
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open && !busy) textareaRef.current?.focus();
  }, [open, busy]);

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

  if (!profileQ.data?.onboarding_completed) return null;

  const working = actions.some((a) => a.state === "running");
  const lastAction = actions[actions.length - 1];

  return (
    <>
      {!open && lastAction ? (
        <div className="animate-toast-in fixed bottom-44 right-4 z-50 max-w-[16rem]">
          <ActionRow action={lastAction} />
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Hablar con el coach"
        className={`fixed bottom-24 right-4 z-50 relative grid h-14 w-14 place-items-center rounded-full shadow-lg transition-all duration-300 active:scale-90 ${
          flash === "done"
            ? "bg-primary text-primary-foreground shadow-primary/50 scale-105"
            : flash === "error"
              ? "bg-destructive text-destructive-foreground shadow-destructive/40"
              : "bg-primary text-primary-foreground shadow-primary/30 hover:scale-105"
        }`}
      >
        {!open && !working && !flash ? (
          <span className="animate-fab-ring pointer-events-none absolute inset-0 rounded-full bg-primary/40" />
        ) : null}
        {working || busy ? (
          <Loader2 className="h-6 w-6 animate-spin" />
        ) : flash === "done" ? (
          <Check className="animate-pop h-6 w-6" />
        ) : flash === "error" ? (
          <AlertCircle className="animate-pop h-6 w-6" />
        ) : (
          <MessageCircle className="h-6 w-6" />
        )}
      </button>

      {open ? (
        <div className="animate-fade-in fixed inset-0 z-50 flex flex-col justify-end bg-foreground/30 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => setOpen(false)}
            className="flex-1"
          />
          <div className="animate-sheet-up mx-auto flex h-[78dvh] w-full max-w-lg flex-col rounded-t-3xl border-t border-border bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
            <div className="flex items-center justify-between pb-2">
              <div>
                <h2 className="font-display text-lg">Coach rápido</h2>
                <p className="text-xs text-muted-foreground">Cuéntame y lo cambio en tu pantalla</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar coach"
                className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <Conversation className="min-h-0 flex-1">
              <ConversationContent className="gap-4 px-0">
                {messages.length === 0 ? (
                  <ConversationEmptyState
                    title="¿Qué ajustamos?"
                    description='Por ejemplo: "peso 78,5", "marca el agua como hecha" o "cambia los platos de hoy".'
                  />
                ) : (
                  messages.map((m) => {
                    const text = m.parts
                      .map((p) => (p.type === "text" ? p.text : ""))
                      .join("")
                      .trim();
                    if (!text) return null;
                    return (
                      <Message key={m.id} from={m.role}>
                        <MessageContent
                          className={
                            m.role === "assistant"
                              ? "bg-transparent p-0 text-foreground"
                              : "bg-primary text-primary-foreground"
                          }
                        >
                          <MessageResponse>{text}</MessageResponse>
                        </MessageContent>
                      </Message>
                    );
                  })
                )}
                {actions.length ? (
                  <div className="space-y-2">
                    {actions.map((a) => (
                      <ActionRow key={a.id} action={a} />
                    ))}
                  </div>
                ) : null}
                {busy && !working ? <Shimmer>Pensando...</Shimmer> : null}

                {error ? (
                  <p className="text-sm text-destructive">
                    No he podido responder ahora mismo. Inténtalo otra vez.
                  </p>
                ) : null}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <PromptInput onSubmit={handleSubmit} className="mt-3">
              <PromptInputTextarea ref={textareaRef} placeholder="Habla con tu coach..." />
              <PromptInputFooter className="justify-between">
                <DictateButton onText={appendDictation} label="Dictar" />
                <PromptInputSubmit status={status} disabled={busy} />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      ) : null}
    </>
  );
}
