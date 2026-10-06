import { useChat } from "@ai-sdk/react";

import { authHeaders } from "@/lib/auth-headers";
import { useQuery } from "@tanstack/react-query";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import {
  Activity,
  AlertCircle,
  Check,
  Loader2,
  MessageCircle,
  Scale,
  Sparkles,
  CalendarRange,
  ListChecks,
  Target,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
import { FAB_CLASS } from "@/components/coach-fab";
import { DictateButton } from "@/components/dictate-button";
import { DictationField, DictationWave } from "@/components/dictation-field";
import {
  addMessage,
  ensureTodayLog,
  fetchMonthlyPlan,
  fetchProfile,
  monthISO,
  todayISO,
  type DailyLog,
  type MonthlyPlanRow,
} from "@/lib/daily";
import { coachPlanContext } from "@/lib/plan-shared";
import { useCoachActions } from "@/lib/use-coach-actions";
import { useSensitiveProfileConfirm } from "@/components/sensitive-profile-confirm";

type ToolCall = { toolCallId: string; toolName: string; input: unknown };

type ActionState = "running" | "done" | "error";
type ActionEntry = { id: string; tool: string; state: ActionState; text: string };

// El texto de cada acción vive en el catálogo: `chat.action.<herramienta>` mientras
// corre y `chat.actionDone.<herramienta>` al acabar.
const ACTION_ICON: Record<string, typeof Scale> = {
  actualizar_peso: Scale,
  marcar_habito: ListChecks,
  anadir_habito: ListChecks,
  quitar_habito: ListChecks,
  regenerar_guia: Sparkles,
  cambiar_plato: UtensilsCrossed,
  registrar_deporte: Activity,
  ajustar_plan_mensual: CalendarRange,
  recalcular_objetivo: Target,
  cambiar_fecha_objetivo: Target,
};

function ActionRow({ action }: { action: ActionEntry }) {
  const Icon = action.state === "error" ? AlertCircle : (ACTION_ICON[action.tool] ?? Sparkles);
  const running = action.state === "running";
  return (
    <div
      className={`animate-toast-in flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-xs font-medium ${
        action.state === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-primary/10 text-primary-ink"
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

// Se carga aparte (ver coach-fab.tsx): `hidden` y la posición del botón llegan de allí.
export default function CoachPanel({
  hidden,
  defaultOpen,
}: {
  hidden: boolean;
  defaultOpen: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [actions, setActions] = useState<ActionEntry[]>([]);
  const [flash, setFlash] = useState<ActionState | null>(null);
  const date = todayISO();

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const todayQ = useQuery({
    queryKey: ["today"],
    queryFn: () => ensureTodayLog([]),
    enabled: open,
  });
  const month = monthISO();
  const planQ = useQuery({
    queryKey: ["plan", month],
    queryFn: () => fetchMonthlyPlan(month),
    enabled: open,
  });

  const ctx = useRef<{
    profile: unknown;
    guide: unknown;
    log: DailyLog | undefined;
    plan: MonthlyPlanRow | null | undefined;
  }>({
    profile: undefined,
    guide: undefined,
    log: undefined,
    plan: undefined,
  });
  ctx.current = {
    profile: profileQ.data,
    guide: todayQ.data?.guide,
    log: todayQ.data,
    plan: planQ.data,
  };
  // Cambios sensibles del perfil que propone el coach: se confirman antes (ticket 31).
  const { confirm: confirmSensitive, dialog: sensitiveDialog } = useSensitiveProfileConfirm();
  const { runToolDetailed, refresh } = useCoachActions(
    () => ctx.current.log,
    () => ctx.current.plan,
    confirmSensitive,
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
            today: todayISO(),
            ...coachPlanContext(ctx.current.plan, todayISO()),
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
          text: t(`chat.action.${toolName}`, { defaultValue: t("chat.action.default") }),
        },
      ]);
      try {
        const { output, applied } = await runToolDetailed(
          toolName,
          (input ?? {}) as Record<string, unknown>,
        );
        refresh();
        // `output` es para el modelo (español canónico, con instrucciones): la
        // chapa enseña su propia etiqueta, y solo dice «hecho» si se aplicó.
        if (applied) {
          settle(
            toolCallId,
            "done",
            t(`chat.actionDone.${toolName}`, { defaultValue: t("chat.actionDone.default") }),
          );
        } else {
          settle(toolCallId, "error", t("chat.actionDone.notApplied"));
        }
        addToolResult({ tool: toolName as never, toolCallId, output });
      } catch (e) {
        // Mismo criterio que en /chat: el motivo real llega al coach (y a la
        // fila de acción) para que pueda explicarlo con sus palabras.
        const reason = e instanceof Error && e.message ? e.message : t("chat.action.failed");
        settle(toolCallId, "error", reason);
        addToolResult({ tool: toolName as never, toolCallId, output: reason });
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

  if (hidden) return null;

  const working = actions.some((a) => a.state === "running");
  const lastAction = actions[actions.length - 1];

  return (
    <>
      {sensitiveDialog}
      {lastAction ? (
        // El aviso vive SIEMPRE en el DOM (solo cambia su visibilidad con
        // `open`) para que cerrar/abrir el coach a medio recalcular no
        // desmonte y remonte esta chapa: si lo hiciera, la propia
        // `animate-toast-in` de ActionRow se reproduciría otra vez por encima
        // de la misma acción que ya se había visto animarse dentro del chat,
        // dando el efecto de animación superpuesta/duplicada. La key por id
        // sigue forzando el remount (y por tanto la animación de entrada)
        // cuando SÍ llega una acción nueva.
        <div
          className={`fixed bottom-[calc(11.25rem+max(1rem,env(safe-area-inset-bottom)))] right-4 z-50 max-w-[16rem] ${
            open ? "invisible" : "visible"
          }`}
        >
          <ActionRow key={lastAction.id} action={lastAction} />
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("chat.fab.open")}
        className={`${FAB_CLASS} ${
          flash === "done"
            ? "bg-primary text-primary-foreground scale-105"
            : flash === "error"
              ? "bg-destructive text-destructive-foreground"
              : "bg-primary text-primary-foreground hover:scale-105"
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
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
            className="flex-1"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="coach-fab-title"
            className="animate-sheet-up mx-auto flex h-[78dvh] w-full max-w-lg flex-col rounded-t-3xl bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4"
          >
            <div className="flex items-center justify-between pb-2">
              <div>
                <h2
                  id="coach-fab-title"
                  className="font-title text-lg font-semibold tracking-[-0.02em]"
                >
                  {t("chat.fab.title")}
                </h2>
                <p className="text-xs text-muted-foreground">{t("chat.fab.subtitle")}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("chat.fab.close")}
                className="grid h-9 w-9 place-items-center rounded-full bg-secondary text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <Conversation className="min-h-0 flex-1">
              <ConversationContent className="gap-4 px-0">
                {messages.length === 0 ? (
                  <ConversationEmptyState
                    title={t("chat.fab.emptyTitle")}
                    description={t("chat.fab.emptyDesc")}
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
                {busy && !working ? <Shimmer>{t("chat.thinking")}</Shimmer> : null}

                {error ? <p className="text-sm text-destructive">{t("chat.fab.error")}</p> : null}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <DictationField>
              <PromptInput onSubmit={handleSubmit} className="mt-3">
                <PromptInputTextarea
                  ref={textareaRef}
                  placeholder={t("chat.fab.placeholder")}
                  aria-label={t("chat.messageLabel")}
                />
                {/* Solo sobre el texto: los botones de debajo siguen a la vista. */}
                <DictationWave className="bottom-12 rounded-none" />
                <PromptInputFooter className="justify-between">
                  <DictateButton onText={appendDictation} />
                  <PromptInputSubmit status={status} disabled={busy} />
                </PromptInputFooter>
              </PromptInput>
            </DictationField>
          </div>
        </div>
      ) : null}
    </>
  );
}
