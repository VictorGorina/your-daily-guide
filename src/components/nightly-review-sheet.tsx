import { Moon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// Frases de cierre del día, cortas y sin presión — rotan por día del año,
// igual que quoteOfTheDay en src/lib/quotes.ts, pero sin depender de ella
// (esta es específica del tono de cierre de jornada, no una cita genérica).
const CLOSING_LINES = [
  "Mañana es una página en blanco. Hoy ya has hecho lo que has podido.",
  "No hace falta un día perfecto, solo un día intentado.",
  "Cada comida registrada es información para ir mejor, no un examen.",
  "Descansa. El cuerpo también avanza mientras duerme.",
  "Lo que cuenta no es hoy solo, es la semana entera.",
  "Un paso más, aunque hoy haya sido pequeño.",
];

function closingLineOfDay(date: Date = new Date()): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return CLOSING_LINES[dayOfYear % CLOSING_LINES.length];
}

type Meal = { label: string; done: boolean; status?: "plan" | "distinto" | "salteo" };

export function NightlyReviewSheet({
  open,
  onOpenChange,
  habits,
  streak,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habits: Meal[];
  streak: number;
  onDone: () => void;
}) {
  const total = habits.length;
  const doneCount = habits.filter((h) => h.status === "plan").length;
  const distintoCount = habits.filter((h) => h.status === "distinto").length;
  const skippedCount = habits.filter((h) => h.status === "salteo").length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2 font-display">
            <Moon className="h-4 w-4 text-primary" /> Repaso de hoy
          </SheetTitle>
          <SheetDescription>Menos de un minuto, sin nota ni examen.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-8">
          <div className="surface-card p-4">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Comidas de hoy
            </span>
            <p className="mt-1 text-sm text-foreground">
              {total ? (
                <>
                  {doneCount} del plan
                  {distintoCount ? `, ${distintoCount} distinto` : ""}
                  {skippedCount ? `, ${skippedCount} saltada${skippedCount > 1 ? "s" : ""}` : ""}
                  {" · "}
                  {total} en total.
                </>
              ) : (
                "Hoy no se han registrado comidas."
              )}
            </p>
            {streak > 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">Racha actual: {streak} 🔥</p>
            ) : null}
          </div>

          <div className="surface-card p-4">
            <p className="text-sm leading-relaxed text-foreground">{closingLineOfDay()}</p>
          </div>

          <Button className="w-full" onClick={onDone}>
            Listo, hasta mañana
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
