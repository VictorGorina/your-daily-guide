import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { DailyLog } from "@/lib/daily";
import { daySignalOf, type DaySignal } from "@/lib/macros";
import {
  dayKind,
  mondayAt,
  weekCount,
  weekDates,
  weekIndexOf,
  weekLabel,
  weekStartOf,
  weekStripBounds,
  weekdayIndex,
  type DayKind,
  type WeekBounds,
} from "@/lib/week-nav";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
// Misma curva que el resto de la app (docs/design-guidelines.md §7) y que
// `mobile/components/week-pager.tsx`, para que la tira se mueva igual en las
// dos plataformas aunque una use Reanimated y la otra `motion`.
const EASE = [0.22, 1, 0.36, 1] as const;
const RING_S = 0.35;
const LABEL_S = 0.2;
const FADE_JUMP_MS = 180;

/**
 * Mismo semáforo que el calendario del mes (`daySignal` en macros.ts): el color
 * de un día pasado dice cómo quedó frente al objetivo del día, no cuántas
 * comidas se marcaron. Las dos superficies tienen que decir lo mismo del mismo
 * día, o el color deja de significar nada.
 */
function habitSignal(log: DailyLog | undefined) {
  return daySignalOf(log);
}

function dayClasses(kind: DayKind, isWeekend: boolean, signal: DaySignal) {
  if (kind === "before-start") return "bg-secondary text-muted-foreground";
  if (kind === "today") return "bg-foreground text-background";
  if (kind === "past") {
    switch (signal) {
      case "success":
        return "bg-success text-success-foreground";
      case "warning":
        return "bg-warning text-warning-foreground";
      case "over":
        return "bg-danger text-danger-foreground";
      case "muted":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-secondary text-muted-foreground";
    }
  }
  // future
  return isWeekend ? "bg-weekend text-weekend-foreground" : "bg-secondary text-muted-foreground";
}

type WeekPagerProps = {
  today: string;
  appStartedOn?: string | null;
  selected?: string | null;
  onSelect?: (date: string) => void;
  /** Lunes de la semana visible. La controla este componente; se informa hacia
   *  fuera porque el padre necesita saber qué meses pedir (logs/plan). */
  visibleWeek: string;
  onVisibleWeekChange: (monday: string) => void;
  logsFor: (date: string) => DailyLog | undefined;
  renderBadge?: (date: string) => ReactNode;
};

/**
 * Tira de la semana de Hoy con paginado entre semanas (feature
 * `hoy-semanas-editables`, ticket 04 — versión web de
 * `mobile/components/week-pager.tsx`, ticket 03). Mismos límites y misma
 * cabecera que móvil; el gesto lo lleva Embla (sin el wrapper de
 * `ui/carousel.tsx`, que trae flechas propias) y las animaciones (anillo,
 * etiqueta, panel del día) `motion`, en vez de Reanimated.
 */
export function WeekPager({
  today,
  appStartedOn,
  selected,
  onSelect,
  visibleWeek,
  onVisibleWeekChange,
  logsFor,
  renderBadge,
}: WeekPagerProps) {
  const reducedMotion = !!useReducedMotion();
  const bounds = useMemo<WeekBounds>(
    () => weekStripBounds(today, appStartedOn),
    [today, appStartedOn],
  );
  const total = weekCount(bounds);
  const visibleIndex = weekIndexOf(visibleWeek, bounds);

  const [viewportRef, emblaApi] = useEmblaCarousel({
    startIndex: visibleIndex,
    align: "start",
    containScroll: false,
    duration: 22,
  });

  // Transform inicial congelado al montar: así el contenedor sale del
  // servidor ya en la semana visible, sin esperar a que Embla se inicialice.
  // Embla toma el control imperativo de este mismo nodo al montarse — no hay
  // que volver a asignar este valor en renders posteriores, o pisaría el
  // scroll que Embla ya haya aplicado (ver ticket 04).
  const [initialTransform] = useState(() => `translate3d(-${visibleIndex * 100}%, 0, 0)`);

  const data = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);
  // Último índice que ya sabemos que refleja Embla (evita reordenar un
  // `scrollTo` sobre un gesto que el usuario ya completó).
  const lastIndexRef = useRef(visibleIndex);
  const [fading, setFading] = useState(false);
  const [labelDir, setLabelDir] = useState(1);

  const goTo = useCallback(
    (index: number) => {
      if (!emblaApi) return;
      const clamped = Math.min(Math.max(index, 0), total - 1);
      if (clamped === lastIndexRef.current) return;
      const monday = mondayAt(clamped, bounds);
      const near = Math.abs(clamped - lastIndexRef.current) <= 2;
      setLabelDir(clamped > lastIndexRef.current ? 1 : -1);
      lastIndexRef.current = clamped;
      if (near || reducedMotion) {
        emblaApi.scrollTo(clamped, reducedMotion);
        onVisibleWeekChange(monday);
        return;
      }
      // Salto lejano (p. ej. "Hoy" desde 5 semanas atrás): fundido del carril
      // en vez de un barrido largo por todas las semanas de en medio.
      setFading(true);
      setTimeout(() => {
        emblaApi.scrollTo(clamped, true);
        onVisibleWeekChange(monday);
        setFading(false);
      }, FADE_JUMP_MS);
    },
    [bounds, emblaApi, onVisibleWeekChange, reducedMotion, total],
  );

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      const index = emblaApi.selectedScrollSnap();
      if (index === lastIndexRef.current) return;
      setLabelDir(index > lastIndexRef.current ? 1 : -1);
      lastIndexRef.current = index;
      onVisibleWeekChange(mondayAt(index, bounds));
    };
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, bounds, onVisibleWeekChange]);

  // Mantiene el ref sincronizado si `visibleWeek` cambia por una vía que no
  // sea el propio gesto (no debería pasar hoy, pero evita desincronías si el
  // padre alguna vez fuerza el valor).
  useEffect(() => {
    lastIndexRef.current = visibleIndex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleWeek]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(visibleIndex - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(visibleIndex + 1);
    }
  };

  const showTodayPill = visibleWeek !== weekStartOf(today);
  const atStart = visibleIndex <= 0;
  const atEnd = visibleIndex >= total - 1;
  const label = weekLabel(visibleWeek, today);

  return (
    <div>
      {/* ── Cabecera: chevrons + etiqueta + "Hoy" ── */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => goTo(visibleIndex - 1)}
          disabled={atStart}
          aria-label="Semana anterior"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground transition-[opacity,transform] active:scale-95 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={visibleWeek}
              initial={{ opacity: 0, x: labelDir * 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -labelDir * 6 }}
              transition={{ duration: LABEL_S, ease: EASE }}
              className="truncate text-[13px] font-semibold text-foreground"
            >
              {label}
            </motion.span>
          </AnimatePresence>
          {showTodayPill ? (
            <button
              type="button"
              onClick={() => goTo(weekIndexOf(today, bounds))}
              className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-num text-[9.5px] font-medium uppercase tracking-wide text-primary transition-opacity active:opacity-70"
            >
              Volver a hoy
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => goTo(visibleIndex + 1)}
          disabled={atEnd}
          aria-label="Semana siguiente"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground transition-[opacity,transform] active:scale-95 disabled:opacity-30"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* ── Carril de semanas ── */}
      <div
        ref={viewportRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="overflow-hidden rounded-2xl outline-none transition-opacity duration-150"
        style={{ touchAction: "pan-y pinch-zoom", opacity: fading ? 0 : 1 }}
      >
        <div className="flex" style={{ transform: initialTransform }}>
          {data.map((index) => {
            const monday = mondayAt(index, bounds);
            const nearVisible = Math.abs(index - visibleIndex) <= 2;
            return (
              <div key={index} className="min-w-0 flex-[0_0_100%]">
                {nearVisible ? (
                  <WeekPage
                    monday={monday}
                    today={today}
                    appStartedOn={appStartedOn}
                    selected={selected}
                    onSelect={onSelect}
                    logsFor={logsFor}
                    renderBadge={renderBadge}
                    reducedMotion={reducedMotion}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WeekPage({
  monday,
  today,
  appStartedOn,
  selected,
  onSelect,
  logsFor,
  renderBadge,
  reducedMotion,
}: {
  monday: string;
  today: string;
  appStartedOn?: string | null;
  selected?: string | null;
  onSelect?: (date: string) => void;
  logsFor: (date: string) => DailyLog | undefined;
  renderBadge?: (date: string) => ReactNode;
  reducedMotion: boolean;
}) {
  const dates = useMemo(() => weekDates(monday), [monday]);

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {dates.map((date) => {
        const kind = dayKind(date, today, appStartedOn);
        const isBeforeStart = kind === "before-start";
        const d = new Date(`${date}T00:00:00`);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        const signal: DaySignal = kind === "past" ? habitSignal(logsFor(date)) : "none";
        const isOpen = selected === date;

        return (
          <button
            key={date}
            type="button"
            onClick={() => (isBeforeStart ? undefined : onSelect?.(date))}
            disabled={isBeforeStart}
            aria-expanded={isOpen}
            style={isBeforeStart ? { opacity: 0.35 } : undefined}
            className={`relative rounded-[14px] px-1 pb-2 pt-2.5 text-center transition-transform active:scale-95 ${dayClasses(kind, isWeekend, signal)}`}
          >
            <span className="block font-title text-[15px] font-semibold leading-none">
              {d.getDate()}
            </span>
            <span className="mt-1 block font-num text-[9.5px] font-medium uppercase tracking-[0.06em] opacity-80">
              {DAYS[weekdayIndex(date)]}
            </span>
            {renderBadge?.(date)}
            {isOpen ? (
              <motion.span
                layoutId={`week-ring-${monday}`}
                className="pointer-events-none absolute inset-0 rounded-[14px] border-2 border-primary"
                transition={reducedMotion ? { duration: 0 } : { duration: RING_S, ease: EASE }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
