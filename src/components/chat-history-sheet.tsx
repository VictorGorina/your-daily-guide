import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, History } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { fetchChatDays, fetchMessages } from "@/lib/daily";

function formatDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function ChatHistorySheet() {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<string | null>(null);

  const daysQ = useQuery({ queryKey: ["chat-days"], queryFn: fetchChatDays, enabled: open });
  const dayQ = useQuery({
    queryKey: ["messages", day],
    queryFn: () => fetchMessages(day as string),
    enabled: open && !!day,
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setDay(null);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <History className="size-4" aria-hidden />
          Historial
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          {day ? (
            <>
              <button
                type="button"
                onClick={() => setDay(null)}
                className="flex items-center gap-1 text-xs text-muted-foreground"
              >
                <ChevronLeft className="size-3.5" aria-hidden />
                Todos los días
              </button>
              <SheetTitle className="font-display capitalize">{formatDay(day)}</SheetTitle>
              <SheetDescription>Conversación guardada, solo lectura.</SheetDescription>
            </>
          ) : (
            <>
              <SheetTitle className="font-display">Historial de conversaciones</SheetTitle>
              <SheetDescription>Revisa lo que hablasteis en días anteriores.</SheetDescription>
            </>
          )}
        </SheetHeader>

        <div className="px-4 pb-6">
          {!day ? (
            daysQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            ) : (daysQ.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay días anteriores. Lo de hoy se guardará automáticamente.
              </p>
            ) : (
              <ul className="space-y-2">
                {daysQ.data?.map((d) => (
                  <li key={d.date}>
                    <button
                      type="button"
                      onClick={() => setDay(d.date)}
                      className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-card/60 px-4 py-3 text-left"
                    >
                      <span className="text-sm capitalize">{formatDay(d.date)}</span>
                      <span className="text-xs text-muted-foreground">{d.count} mensajes</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : dayQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <div className="space-y-3">
              {dayQ.data?.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "ml-auto max-w-[85%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : "max-w-[95%] text-sm text-foreground"
                  }
                >
                  {m.content}
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
