import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { ratioSignal, type DailyLog } from "../lib/daily";
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
  type WeekBounds,
} from "../lib/week-nav";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
// Misma curva que el resto de la app (docs/design-guidelines.md §7).
const EASING = Easing.bezier(0.22, 1, 0.36, 1);
const RING_MS = 350;
const LABEL_MS = 200;
const FADE_JUMP_MS = 180;
const GAP = 6;
const ROW_HEIGHT = 64;

function habitSignal(log: DailyLog | undefined, fallbackHabits: string[]) {
  const habits = log?.habits ?? (fallbackHabits ?? []).map((label) => ({ label, done: false }));
  return ratioSignal(habits.filter((h) => h.done).length, habits.length);
}

function signalClasses(signal: ReturnType<typeof ratioSignal>) {
  switch (signal) {
    case "success":
      return "bg-success";
    case "warning":
      return "bg-warning";
    case "muted":
      return "bg-muted";
    default:
      return "";
  }
}
function signalText(signal: ReturnType<typeof ratioSignal>) {
  switch (signal) {
    case "success":
      return "text-success-foreground";
    case "warning":
      return "text-warning-foreground";
    case "muted":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

// Fin de semana futuro — mismo hex fijo que la web (docs/design-guidelines.md
// §2, tokens --weekend/--weekend-foreground en src/styles.css).
const WEEKEND_BG = "#f7e2ce";
const WEEKEND_TEXT = "#a85f24";

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
  todayHabits?: string[];
  renderBadge?: (date: string) => ReactNode;
};

/**
 * Tira de la semana de Hoy con paginado entre semanas (feature
 * `hoy-semanas-editables`, ticket 03). Reemplaza a `week-strip.tsx`: misma
 * regla de semáforo/fin de semana por día, pero navegable hacia atrás y hacia
 * delante con los mismos límites que la pantalla Plan (`weekStripBounds`).
 *
 * El componente decide él solo cómo se desplaza (chevrons, paginado nativo,
 * "Hoy"); `visibleWeek`/`onVisibleWeekChange` solo existen para que el padre
 * sepa qué mes(es) pedir a la base de datos y pueda plegar el panel del día
 * cuando deja de pertenecer a la semana visible.
 */
export function WeekPager({
  today,
  appStartedOn,
  selected,
  onSelect,
  visibleWeek,
  onVisibleWeekChange,
  logsFor,
  todayHabits = [],
  renderBadge,
}: WeekPagerProps) {
  const reducedMotion = useReducedMotion();
  const bounds = useMemo<WeekBounds>(
    () => weekStripBounds(today, appStartedOn),
    [today, appStartedOn],
  );
  const total = weekCount(bounds);
  const visibleIndex = weekIndexOf(visibleWeek, bounds);

  const [width, setWidth] = useState(0);
  const listRef = useRef<FlatList<number>>(null);
  // Último índice que ya sabemos que refleja el `FlatList` (evita reordenar un
  // `scrollToIndex` sobre un gesto que el usuario ya completó).
  const lastIndexRef = useRef(visibleIndex);
  const [fading, setFading] = useState(false);

  const data = useMemo(() => Array.from({ length: total }, (_, i) => i), [total]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const w = e.nativeEvent.layout.width;
      if (w > 0 && w !== width) setWidth(w);
    },
    [width],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({ length: width, offset: width * index, index }),
    [width],
  );

  const goTo = useCallback(
    (index: number) => {
      const clamped = Math.min(Math.max(index, 0), total - 1);
      if (clamped === lastIndexRef.current) return;
      const monday = mondayAt(clamped, bounds);
      const near = Math.abs(clamped - lastIndexRef.current) <= 2;
      lastIndexRef.current = clamped;
      if (near || reducedMotion) {
        listRef.current?.scrollToIndex({ index: clamped, animated: !reducedMotion });
        onVisibleWeekChange(monday);
        return;
      }
      // Salto lejano (p. ej. "Hoy" desde 5 semanas atrás): fundido del carril
      // en vez de un barrido largo por todas las semanas de en medio.
      setFading(true);
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: clamped, animated: false });
        onVisibleWeekChange(monday);
        setFading(false);
      }, FADE_JUMP_MS);
    },
    [bounds, onVisibleWeekChange, reducedMotion, total],
  );

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!width) return;
      const index = Math.round(e.nativeEvent.contentOffset.x / width);
      const clamped = Math.min(Math.max(index, 0), total - 1);
      if (clamped === lastIndexRef.current) return;
      lastIndexRef.current = clamped;
      onVisibleWeekChange(mondayAt(clamped, bounds));
    },
    [bounds, onVisibleWeekChange, total, width],
  );

  // Mantiene el ref sincronizado si `visibleWeek` cambia por una vía que no
  // sea el propio gesto (no debería pasar hoy, pero evita desincronías si el
  // padre alguna vez fuerza el valor).
  useEffect(() => {
    lastIndexRef.current = visibleIndex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleWeek]);

  const showTodayPill = visibleWeek !== weekStartOf(today);
  const atStart = visibleIndex <= 0;
  const atEnd = visibleIndex >= total - 1;

  const label = weekLabel(visibleWeek, today);

  const cellWidth = width > 0 ? (width - GAP * 6) / 7 : 0;

  return (
    <View>
      {/* ── Cabecera: chevrons + etiqueta + "Hoy" ── */}
      <View className="mb-2 flex-row items-center justify-between">
        <Pressable
          onPress={() => goTo(visibleIndex - 1)}
          disabled={atStart}
          hitSlop={8}
          className="h-8 w-8 items-center justify-center rounded-full bg-surface active:opacity-70"
          style={atStart ? { opacity: 0.3 } : undefined}
        >
          <ChevronLeft size={16} color="#83796c" />
        </Pressable>
        <View className="min-w-0 flex-1 flex-row items-center justify-center gap-2">
          <Animated.Text
            key={visibleWeek}
            entering={FadeIn.duration(LABEL_MS)}
            exiting={FadeOut.duration(LABEL_MS)}
            className="font-body-semibold text-[13px] text-foreground"
            numberOfLines={1}
          >
            {label}
          </Animated.Text>
          {showTodayPill ? (
            <Pressable
              onPress={() => goTo(weekIndexOf(today, bounds))}
              hitSlop={6}
              className="rounded-full bg-primary/10 px-2 py-0.5 active:opacity-70"
            >
              <Text className="font-mono-medium text-[9.5px] uppercase tracking-wide text-primary">
                Hoy
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => goTo(visibleIndex + 1)}
          disabled={atEnd}
          hitSlop={8}
          className="h-8 w-8 items-center justify-center rounded-full bg-surface active:opacity-70"
          style={atEnd ? { opacity: 0.3 } : undefined}
        >
          <ChevronRight size={16} color="#83796c" />
        </Pressable>
      </View>

      {/* ── Carril de semanas ── */}
      <View onLayout={onLayout} style={{ height: ROW_HEIGHT, opacity: fading ? 0 : 1 }}>
        {width > 0 ? (
          <FlatList
            ref={listRef}
            data={data}
            keyExtractor={(i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            windowSize={3}
            initialScrollIndex={visibleIndex}
            getItemLayout={getItemLayout}
            onMomentumScrollEnd={onMomentumScrollEnd}
            renderItem={({ index }) => {
              const monday = mondayAt(index, bounds);
              const nearVisible = Math.abs(index - visibleIndex) <= 2;
              if (!nearVisible) return <View style={{ width, height: ROW_HEIGHT }} />;
              return (
                <WeekPage
                  width={width}
                  cellWidth={cellWidth}
                  monday={monday}
                  today={today}
                  appStartedOn={appStartedOn}
                  selected={selected}
                  onSelect={onSelect}
                  logsFor={logsFor}
                  todayHabits={todayHabits}
                  renderBadge={renderBadge}
                  reducedMotion={reducedMotion}
                />
              );
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

function WeekPage({
  width,
  cellWidth,
  monday,
  today,
  appStartedOn,
  selected,
  onSelect,
  logsFor,
  todayHabits,
  renderBadge,
  reducedMotion,
}: {
  width: number;
  cellWidth: number;
  monday: string;
  today: string;
  appStartedOn?: string | null;
  selected?: string | null;
  onSelect?: (date: string) => void;
  logsFor: (date: string) => DailyLog | undefined;
  todayHabits: string[];
  renderBadge?: (date: string) => ReactNode;
  reducedMotion: boolean;
}) {
  const dates = useMemo(() => weekDates(monday), [monday]);
  const selectedIndex = selected ? dates.indexOf(selected) : -1;

  const ringX = useSharedValue(selectedIndex >= 0 ? selectedIndex : 0);
  const prevSelectedRef = useRef<string | null | undefined>(selected);
  useEffect(() => {
    if (selectedIndex < 0) return;
    const cameFromThisWeek = !!prevSelectedRef.current && dates.includes(prevSelectedRef.current);
    ringX.value =
      cameFromThisWeek && !reducedMotion
        ? withTiming(selectedIndex, { duration: RING_MS, easing: EASING })
        : selectedIndex;
    prevSelectedRef.current = selected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: ringX.value * (cellWidth + GAP) }],
  }));

  return (
    <View style={{ width, height: ROW_HEIGHT }}>
      <View className="flex-row" style={{ gap: GAP }}>
        {dates.map((date) => {
          const kind = dayKind(date, today, appStartedOn);
          const isToday = kind === "today";
          const isPast = kind === "past";
          const isBeforeStart = kind === "before-start";
          const d = new Date(`${date}T00:00:00`);
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const signal = isPast ? habitSignal(logsFor(date), todayHabits) : "none";
          const isFutureWeekend = !isToday && !isPast && !isBeforeStart && isWeekend;

          const containerBase = isBeforeStart
            ? "bg-secondary"
            : isToday
              ? "bg-foreground"
              : isPast
                ? signalClasses(signal) || "bg-secondary"
                : isFutureWeekend
                  ? ""
                  : "bg-secondary";
          const textBase = isBeforeStart
            ? "text-muted-foreground"
            : isToday
              ? "text-background"
              : isPast
                ? signalText(signal)
                : isFutureWeekend
                  ? ""
                  : "text-muted-foreground";

          return (
            <Pressable
              key={date}
              onPress={() => (isBeforeStart ? undefined : onSelect?.(date))}
              disabled={isBeforeStart}
              style={[
                { width: cellWidth, opacity: isBeforeStart ? 0.35 : 1 },
                isFutureWeekend ? { backgroundColor: WEEKEND_BG } : undefined,
              ]}
              className={`items-center gap-0.5 rounded-[14px] py-2.5 active:opacity-80 ${containerBase}`}
            >
              <Text
                style={isFutureWeekend ? { color: WEEKEND_TEXT } : undefined}
                className={`text-base font-heading-medium leading-none ${textBase}`}
              >
                {d.getDate()}
              </Text>
              <Text
                style={isFutureWeekend ? { color: WEEKEND_TEXT } : undefined}
                className={`text-[9.5px] font-mono-medium uppercase tracking-[0.06em] ${textBase}`}
              >
                {DAYS[weekdayIndex(date)]}
              </Text>
              {renderBadge?.(date)}
            </Pressable>
          );
        })}
      </View>
      {selectedIndex >= 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              width: cellWidth,
              borderRadius: 14,
              borderWidth: 2,
              borderColor: "#ff8a3d",
            },
            ringStyle,
          ]}
        />
      ) : null}
    </View>
  );
}
