import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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
import { dateLocale } from "@/lib/i18n";
import { capitalizeFirst } from "@/lib/plan-shared";

function formatDay(date: string, locale: string) {
  return capitalizeFirst(
    new Date(`${date}T12:00:00`).toLocaleDateString(dateLocale(locale), {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  );
}

export function ChatHistorySheet() {
  const { t, i18n } = useTranslation();
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
          {t("chat.history.button")}
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
                {t("chat.history.allDays")}
              </button>
              <SheetTitle className="font-title font-semibold tracking-[-0.02em]">
                {formatDay(day, i18n.language)}
              </SheetTitle>
              <SheetDescription>{t("chat.history.readOnly")}</SheetDescription>
            </>
          ) : (
            <>
              <SheetTitle className="font-title font-semibold tracking-[-0.02em]">
                {t("chat.history.title")}
              </SheetTitle>
              <SheetDescription>{t("chat.history.desc")}</SheetDescription>
            </>
          )}
        </SheetHeader>

        <div className="px-4 pb-6">
          {!day ? (
            daysQ.isLoading ? (
              <p className="text-sm text-muted-foreground">{t("chat.history.loading")}</p>
            ) : (daysQ.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">{t("chat.history.empty")}</p>
            ) : (
              <ul className="space-y-2">
                {daysQ.data?.map((d) => (
                  <li key={d.date}>
                    <button
                      type="button"
                      onClick={() => setDay(d.date)}
                      className="flex w-full items-center justify-between rounded-xl bg-secondary/60 px-4 py-3 text-left"
                    >
                      <span className="text-sm">{formatDay(d.date, i18n.language)}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("chat.history.count", { count: d.count })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : dayQ.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("chat.history.loading")}</p>
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
