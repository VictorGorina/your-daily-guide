import { Moon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MealStatus, WeeklyTrend } from "@/lib/daily";

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

type Tone = "relajado" | "neutro" | "exigente";
const toneOf = (tone?: string | null): Tone =>
  tone === "relajado" || tone === "exigente" ? tone : "neutro";

// Reacción al día de hoy, adaptada al matiz elegido en el perfil (Ajustes).
// El coach de chat ya adapta su tono vía toneLine en ai-provider.server.ts;
// esto lleva el mismo matiz a un texto puramente local, sin llamada a IA.
function reactionLine(tone: Tone, ratio: number): string {
  if (ratio >= 1) {
    return {
      relajado: "Día redondo, sin ni siquiera proponértelo. Disfrútalo.",
      neutro: "Día completo. Bien hecho.",
      exigente: "Día completo — así se construye un buen mes.",
    }[tone];
  }
  if (ratio > 0) {
    return {
      relajado: "Parte del día ha ido bien, y eso ya suma. Sin más cuentas.",
      neutro: "Un día parcial. Lo que has hecho también cuenta.",
      exigente: "Día a medias — mañana puedes cerrarlo del todo.",
    }[tone];
  }
  return {
    relajado: "Hoy no ha tocado, y no pasa nada. Mañana es otro día.",
    neutro: "Hoy no se ha registrado nada, sin drama.",
    exigente: "Hoy se ha quedado en cero — mañana toca retomarlo.",
  }[tone];
}

// Feedback de tendencia semanal (en vez de fijarse solo en el cumplimiento
// de hoy), también matizado por tono. weeklyTrendFrom exige al menos 2 días
// registrados en cada una de las dos semanas, así que null es habitual al
// principio.
function weeklyTrendLine(tone: Tone, trend: WeeklyTrend | null): string | null {
  if (!trend) return null;
  if (trend.deltaPts >= 5) {
    return {
      relajado: `Esta semana vas mejor que la anterior (${trend.thisWeek}% vs ${trend.lastWeek}%) — nota lo que ha funcionado.`,
      neutro: `Tendencia semanal: ${trend.thisWeek}%, frente al ${trend.lastWeek}% de la semana pasada. Vas a mejor.`,
      exigente: `Semana en subida: ${trend.thisWeek}% vs ${trend.lastWeek}%. Sigue empujando.`,
    }[tone];
  }
  if (trend.deltaPts <= -5) {
    return {
      relajado: `Esta semana ha costado algo más (${trend.thisWeek}% vs ${trend.lastWeek}%), y está bien. No todas las semanas son iguales.`,
      neutro: `Esta semana: ${trend.thisWeek}%, algo por debajo del ${trend.lastWeek}% anterior.`,
      exigente: `Esta semana baja al ${trend.thisWeek}% (antes ${trend.lastWeek}%). Toca reajustar, no rendirse.`,
    }[tone];
  }
  return {
    relajado: `Esta semana vas parecido a la anterior (${trend.thisWeek}%). Constancia tranquila.`,
    neutro: `Esta semana: ${trend.thisWeek}%, similar a la pasada.`,
    exigente: `Semana estable en ${trend.thisWeek}%. Para subir, un empujón más cada día.`,
  }[tone];
}

type Meal = { label: string; done: boolean; status?: MealStatus };

export function NightlyReviewSheet({
  open,
  onOpenChange,
  habits,
  impulso,
  weeklyTrend,
  tone,
  onDone,
  onSkipPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  habits: Meal[];
  impulso: number;
  weeklyTrend: WeeklyTrend | null;
  tone?: string | null;
  onDone: () => void;
  /** Cierra en bloque, como saltadas, las comidas que se quedaron sin marcar. */
  onSkipPending?: () => void;
}) {
  const total = habits.length;
  const doneCount = habits.filter((h) => h.status === "plan").length;
  const distintoCount = habits.filter((h) => h.status === "distinto").length;
  const skippedCount = habits.filter((h) => h.status === "salteo").length;
  const pending = habits.filter((h) => h.status == null);
  const ratio = total ? habits.filter((h) => h.done).length / total : 0;
  const t = toneOf(tone);
  const trendLine = weeklyTrendLine(t, weeklyTrend);

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
          {pending.length > 0 && onSkipPending ? (
            <div className="surface-card border border-dashed border-primary/40 p-4">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Sin marcar todavía
              </span>
              <p className="mt-1 text-sm text-foreground">
                {pending.map((h) => h.label).join(", ")} — si ya no vas a más hoy, puedes cerrarlas
                sin más, no cuentan como un fallo.
              </p>
              <Button variant="secondary" className="mt-3 w-full" onClick={onSkipPending}>
                Hoy paso de estas
              </Button>
            </div>
          ) : null}

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
            <p className="mt-2 text-sm text-foreground">{reactionLine(t, ratio)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Impulso: {impulso}% 🔥</p>
          </div>

          {trendLine ? (
            <div className="surface-card p-4">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Esta semana
              </span>
              <p className="mt-1 text-sm text-foreground">{trendLine}</p>
            </div>
          ) : null}

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
