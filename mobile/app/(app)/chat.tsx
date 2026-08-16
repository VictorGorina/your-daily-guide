import { useChat } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";
import { fetch as expoFetch } from "expo/fetch";
import { useRouter } from "expo-router";
import { ArrowUp, ChevronLeft, ClipboardList } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GuidedLogSheet } from "../../components/guided-log-sheet";
import { API_BASE_URL, getAccessToken } from "../../lib/api";
import {
  addMessage,
  ensureTodayLog,
  fetchMessages,
  fetchMonthlyPlan,
  fetchProfile,
  monthISO,
  todayISO,
} from "../../lib/daily";
import { consumePendingChatMessage } from "../../lib/pending-chat-message";
import { coachPlanContext, type ShoppingList } from "../../lib/plan-shared";
import { useCoachActions } from "../../lib/use-coach-actions";

const QUICK_PROMPTS = [
  "Ya he desayunado 🥣",
  "He comido fuera de casa",
  "Me he saltado el plan",
  "He salido a correr 🏃",
  "Hoy tengo mucha hambre",
  "Me siento sin energía",
  "Ajusta el plan de mañana",
  "Cámbiame el desayuno de mañana",
  "¿Qué ceno hoy?",
];

export default function Chat() {
  const router = useRouter();
  const date = todayISO();

  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const todayQ = useQuery({ queryKey: ["today"], queryFn: () => ensureTodayLog([]) });
  const historyQ = useQuery({ queryKey: ["messages", date], queryFn: () => fetchMessages(date) });
  const month = monthISO();
  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });

  // Contexto vivo para el cuerpo de cada petición: se lee en el momento de
  // enviar, no cuando se creó el transport, así el coach ve siempre lo último.
  const ctx = useRef({
    profile: profileQ.data,
    guide: todayQ.data?.guide,
    log: todayQ.data,
    plan: planQ.data,
  });
  ctx.current = {
    profile: profileQ.data,
    guide: todayQ.data?.guide,
    log: todayQ.data,
    plan: planQ.data,
  };
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
        // React Native no puede llamar server functions ni asume same-origin:
        // URL absoluta al backend y `expo/fetch`, que sí sabe leer el cuerpo de
        // la respuesta en streaming (el fetch global de RN no).
        api: `${API_BASE_URL}/api/chat`,
        fetch: expoFetch as unknown as typeof globalThis.fetch,
        prepareSendMessagesRequest: async ({ messages }) => {
          const token = await getAccessToken();
          return {
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: {
              messages,
              profile: ctx.current.profile,
              guide: ctx.current.guide,
              actions: true,
              today: todayISO(),
              ...coachPlanContext(
                ctx.current.plan
                  ? {
                      plan: ctx.current.plan.plan,
                      shopping: (ctx.current.plan.shopping as ShoppingList | null) ?? null,
                      confirmed_at: ctx.current.plan.confirmed_at,
                    }
                  : null,
                todayISO(),
              ),
              log: ctx.current.log
                ? {
                    fecha: ctx.current.log.log_date,
                    peso: ctx.current.log.weight_kg,
                    habitos: ctx.current.log.habits,
                    notas: ctx.current.log.notes,
                  }
                : null,
            },
          };
        },
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
      } catch (e) {
        // El motivo real (día pasado, mes sin plan...) le sirve al coach para
        // explicarlo en su respuesta en vez de decir sólo que no ha podido.
        addToolResult({
          tool: toolName as never,
          toolCallId,
          output: e instanceof Error && e.message ? e.message : "No se ha podido aplicar el cambio",
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

  const busy = status === "submitted" || status === "streaming";

  const [input, setInput] = useState("");
  const [guidedOpen, setGuidedOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  // Mantén la conversación pegada al final según crece la respuesta.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages, busy]);

  const send = (text: string) => {
    const clean = text.trim();
    if (!clean || busy) return;
    void addMessage("user", clean);
    void sendMessage({ text: clean });
  };

  const handleSubmit = () => {
    if (!input.trim() || busy) return;
    send(input);
    setInput("");
  };

  // Mensaje dejado desde fuera de /chat (p.ej. el registro guiado de "Comí
  // distinto" en hoy.tsx). Se envía en cuanto el historial de hoy ha cargado,
  // para no perderlo si setMessages(initial) llega justo después.
  const sentPendingRef = useRef(false);
  useEffect(() => {
    if (!historyQ.isSuccess || sentPendingRef.current) return;
    const pending = consumePendingChatMessage();
    if (pending) {
      sentPendingRef.current = true;
      send(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyQ.isSuccess]);

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString("es-ES", { dateStyle: "long" });

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="mx-auto w-full max-w-lg flex-1 px-4 pt-2">
          {/* Cabecera */}
          <View className="flex-row items-end justify-between px-1 pb-3">
            <View className="flex-row items-center gap-2">
              <Pressable
                onPress={() => (router.canGoBack() ? router.back() : router.navigate("/hoy"))}
                hitSlop={8}
                className="-ml-1 h-9 w-9 items-center justify-center rounded-full active:opacity-70"
              >
                <ChevronLeft size={22} color="#677380" />
              </Pressable>
              <View>
                <Text className="text-2xl font-semibold text-foreground">Tu coach</Text>
                <Text className="text-xs text-muted-foreground">Conversación de hoy · {dateLabel}</Text>
              </View>
            </View>
            <Pressable
              onPress={() => setGuidedOpen(true)}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full border border-border active:opacity-70"
            >
              <ClipboardList size={18} color="#677380" />
            </Pressable>
          </View>

          {/* Conversación */}
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerClassName="gap-4 py-2"
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View className="mt-10 items-center gap-1 px-6">
                <Text className="text-center text-lg font-semibold text-foreground">
                  Cuéntame cómo va tu día
                </Text>
                <Text className="text-center text-sm text-muted-foreground">
                  Qué has comido, cómo te sientes o qué te cuesta hoy.
                </Text>
              </View>
            ) : (
              messages.map((m) => {
                const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
                if (!text) return null;
                const mine = m.role === "user";
                return (
                  <View
                    key={m.id}
                    className={`max-w-[85%] rounded-3xl px-4 py-2.5 ${
                      mine ? "self-end bg-primary" : "self-start bg-surface border border-border"
                    }`}
                  >
                    <Text className={`text-[15px] leading-relaxed ${mine ? "text-primary-foreground" : "text-foreground"}`}>
                      {text}
                    </Text>
                  </View>
                );
              })
            )}
            {status === "submitted" ? (
              <View className="flex-row items-center gap-2 self-start rounded-3xl border border-border bg-surface px-4 py-3">
                <ActivityIndicator size="small" color="#4f8ac6" />
                <Text className="text-sm text-muted-foreground">El coach está pensando...</Text>
              </View>
            ) : null}
            {error ? (
              <Text className="self-start text-sm text-destructive">
                El coach no ha podido responder. Inténtalo de nuevo en un momento.
              </Text>
            ) : null}
          </ScrollView>

          {/* Sugerencias rápidas */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-4 max-h-11 flex-grow-0"
            contentContainerClassName="gap-2 px-4 py-1"
            keyboardShouldPersistTaps="handled"
          >
            {QUICK_PROMPTS.map((q) => (
              <Pressable
                key={q}
                disabled={busy}
                onPress={() => send(q)}
                className="rounded-full border border-border bg-surface px-3 py-1.5 active:opacity-70"
                style={busy ? { opacity: 0.5 } : undefined}
              >
                <Text className="text-xs text-muted-foreground">{q}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Entrada */}
          <View className="mb-2 mt-2 flex-row items-end gap-2">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Escribe a tu coach..."
              placeholderTextColor="#9aa5b1"
              multiline
              editable={!busy}
              onSubmitEditing={handleSubmit}
              className="max-h-32 flex-1 rounded-3xl border border-border bg-surface px-4 py-3 text-[15px] text-foreground"
            />
            <Pressable
              onPress={handleSubmit}
              disabled={busy || !input.trim()}
              className="h-12 w-12 items-center justify-center rounded-full bg-primary active:opacity-80"
              style={busy || !input.trim() ? { opacity: 0.4 } : undefined}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#f9fcff" />
              ) : (
                <ArrowUp size={22} color="#f9fcff" />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <GuidedLogSheet open={guidedOpen} onOpenChange={setGuidedOpen} onSend={send} disabled={busy} />
    </SafeAreaView>
  );
}
