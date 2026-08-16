import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarRange,
  CheckCircle2,
  Lock,
  RefreshCw,
  Share2,
  ShoppingBasket,
  Sparkles,
} from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { Dialog } from "../../components/ui/dialog";
import { apiPost } from "../../lib/api";
import { fetchMonthlyPlan, fetchProfile, monthISO, todayISO } from "../../lib/daily";
import {
  cadenceOf,
  CADENCES,
  eur,
  groupByTrip,
  mealsForDate,
  offListNote,
  planForDate,
  shoppingToText,
  shoppingTotal,
  tripLabel,
  type MonthlyPlan,
  type ShoppingCadence,
  type ShoppingList,
} from "../../lib/plan-shared";

type GenerateResult = { plan: MonthlyPlan; shopping: ShoppingList };

export default function Plan() {
  const qc = useQueryClient();
  const month = monthISO();
  const [tab, setTab] = useState<"plan" | "compra">("plan");
  const [cadence, setCadence] = useState<ShoppingCadence | null>(null);

  const planQ = useQuery({ queryKey: ["plan", month], queryFn: () => fetchMonthlyPlan(month) });
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });

  const generate = useMutation({
    mutationFn: (nextCadence?: ShoppingCadence) =>
      apiPost<GenerateResult>("plan/generate", {
        month,
        cadence: nextCadence ?? cadence ?? "mensual",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan", month] }),
    onError: (e) =>
      Alert.alert(e instanceof Error ? e.message : "No hemos podido crear el plan ahora mismo"),
  });

  const lock = useMutation({
    mutationFn: () => apiPost<{ ok: true }>("plan/confirm", { month }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan", month] });
      Alert.alert("Compra confirmada: los ingredientes del mes quedan fijos");
    },
    onError: () => Alert.alert("No hemos podido confirmar la compra"),
  });

  const plan = planQ.data?.plan ?? null;
  const shopping = planQ.data?.shopping ?? null;
  const confirmed = Boolean(planQ.data?.confirmed_at);
  const total = shoppingTotal(shopping);
  const activeCadence: ShoppingCadence = cadence ?? cadenceOf(shopping);
  const trips = groupByTrip(shopping);

  // En iOS la hoja de compartir ya incluye "Copiar" y "Guardar en Archivos", así
  // que un único botón "Compartir" cubre los tres de la web (compartir/copiar/
  // descargar) de la forma nativa, sin escribir un fichero a mano.
  const shareList = async () => {
    try {
      await Share.share({
        title: "Lista de la compra",
        message: shoppingToText(shopping, activeCadence, month),
      });
    } catch {
      /* el usuario canceló el diálogo de compartir */
    }
  };

  const budget = Number(profileQ.data?.budget_month_eur ?? 0);
  const overBudget = budget > 0 && total > budget;
  const budgetRatio = budget > 0 ? Math.min(100, (total / budget) * 100) : 0;
  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString("es-ES", {
    month: "long",
    year: "numeric",
  });

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-36 pt-6">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Plan mensual
            </Text>
            <Text className="text-3xl font-semibold capitalize text-foreground" numberOfLines={1}>
              {monthLabel}
            </Text>
          </View>
          {plan && !confirmed ? (
            <Pressable
              onPress={() => generate.mutate(undefined)}
              disabled={generate.isPending}
              className="mt-1 h-11 w-11 items-center justify-center rounded-full border border-input bg-surface active:opacity-70"
              style={generate.isPending ? { opacity: 0.6 } : undefined}
            >
              {generate.isPending ? (
                <ActivityIndicator size="small" color="#677380" />
              ) : (
                <RefreshCw size={18} color="#677380" />
              )}
            </Pressable>
          ) : null}
        </View>

        {!plan ? (
          <View className="mt-8 items-center rounded-3xl border border-border bg-surface p-6">
            <CalendarRange size={28} color="#4f8ac6" />
            <Text className="mt-3 text-sm font-semibold text-foreground">
              Todavía no tienes plan de este mes
            </Text>
            <Text className="mt-1.5 text-center text-sm text-muted-foreground">
              Un mes de comidas flexibles y su lista de la compra con precios, ajustada a tu
              presupuesto.
            </Text>
            <Pressable
              onPress={() => generate.mutate(undefined)}
              disabled={generate.isPending || planQ.isLoading}
              className="mt-5 w-full items-center rounded-full bg-primary py-4 active:opacity-90"
              style={generate.isPending || planQ.isLoading ? { opacity: 0.6 } : undefined}
            >
              <Text className="text-sm font-semibold text-primary-foreground">
                {generate.isPending ? "Preparando tu mes..." : "Crear plan del mes"}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View className="mt-6 flex-row gap-2 rounded-full bg-secondary/80 p-1">
              {(
                [
                  ["plan", "Plan", CalendarRange],
                  ["compra", "La compra", ShoppingBasket],
                ] as const
              ).map(([key, label, Icon]) => {
                const active = tab === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setTab(key)}
                    className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-2.5 active:opacity-80 ${
                      active ? "bg-surface" : ""
                    }`}
                  >
                    <Icon size={16} color={active ? "#4f8ac6" : "#677380"} />
                    <Text
                      className={`text-sm font-medium ${active ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {tab === "plan" ? (
              <View className="mt-5 gap-5">
                <View className="rounded-3xl border border-border bg-surface p-5">
                  <View className="flex-row items-center gap-2">
                    <Sparkles size={16} color="#4f8ac6" />
                    <Text className="text-sm font-semibold text-foreground">
                      Cómo enfocamos el mes
                    </Text>
                  </View>
                  <Text className="mt-2 text-sm leading-relaxed text-foreground">{plan.intro}</Text>
                  {plan.focus.length ? (
                    <View className="mt-3 gap-1.5">
                      {plan.focus.map((f) => (
                        <View key={f} className="flex-row gap-2">
                          <View className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                          <Text className="flex-1 text-sm text-foreground">{f}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <Text className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    Solo cocinas con lo que has comprado. Si te saltas un día, dímelo en el chat y
                    recoloco los siguientes.
                  </Text>
                </View>

                <PlanMonthCalendar plan={plan} month={month} />
              </View>
            ) : (
              <View className="mt-5 gap-4">
                <View className="rounded-3xl border border-border bg-surface p-5">
                  <View className="flex-row items-baseline justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold text-foreground">
                        Total orientativo del mes
                      </Text>
                      <Text className="mt-1 text-xs text-muted-foreground">
                        {budget > 0
                          ? `Tu presupuesto: ${eur(budget)}`
                          : "Sin presupuesto definido en tu perfil"}
                      </Text>
                    </View>
                    <Text
                      className={`text-2xl font-bold tabular-nums ${overBudget ? "text-destructive" : "text-primary"}`}
                    >
                      {eur(total)}
                    </Text>
                  </View>
                  {budget > 0 ? (
                    <View className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                      <View
                        className={`h-full rounded-full ${
                          overBudget
                            ? "bg-danger"
                            : total / budget >= 0.85
                              ? "bg-warning"
                              : "bg-success"
                        }`}
                        style={{ width: `${budgetRatio}%` }}
                      />
                    </View>
                  ) : null}
                  {overBudget ? (
                    <Text className="mt-2 text-xs text-destructive">
                      Se pasa de tu presupuesto. Puedo ajustarlo: regenera el plan o dímelo en el
                      chat.
                    </Text>
                  ) : null}

                  {confirmed ? (
                    <View className="mt-4 flex-row items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2.5">
                      <Lock size={14} color="#677380" />
                      <Text className="flex-1 text-xs text-muted-foreground">
                        Compra confirmada: los ingredientes del mes ya no cambian. Los platos sí
                        puedo recolocarlos.
                      </Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => lock.mutate()}
                      disabled={lock.isPending}
                      className="mt-4 flex-row items-center justify-center gap-2 rounded-full bg-primary py-3.5 active:opacity-90"
                      style={lock.isPending ? { opacity: 0.6 } : undefined}
                    >
                      <CheckCircle2 size={16} color="#f9fcff" />
                      <Text className="text-sm font-semibold text-primary-foreground">
                        {lock.isPending ? "Confirmando..." : "Ya he comprado esto"}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {shopping?.length ? (
                  <Pressable
                    onPress={() => void shareList()}
                    className="flex-row items-center justify-center gap-2 rounded-2xl border border-input bg-surface py-3.5 active:opacity-80"
                  >
                    <Share2 size={16} color="#4f8ac6" />
                    <Text className="text-sm font-semibold text-foreground">
                      Compartir la lista
                    </Text>
                  </Pressable>
                ) : null}

                <View className="rounded-3xl border border-border bg-surface p-5">
                  <Text className="text-sm font-semibold text-foreground">Cada cuánto compras</Text>
                  <Text className="mt-1 text-xs text-muted-foreground">
                    Reparto los frescos entre compras para que nada se eche a perder.
                  </Text>
                  <View className="mt-3 flex-row gap-2">
                    {CADENCES.map((c) => {
                      const active = activeCadence === c.key;
                      const disabled = confirmed || generate.isPending;
                      return (
                        <Pressable
                          key={c.key}
                          onPress={() => {
                            if (disabled) return;
                            setCadence(c.key);
                            if (c.key !== activeCadence) generate.mutate(c.key);
                          }}
                          disabled={disabled}
                          className={`flex-1 items-center rounded-2xl border px-2 py-2.5 active:opacity-80 ${
                            active ? "border-transparent bg-primary" : "border-input bg-surface"
                          }`}
                          style={disabled ? { opacity: 0.6 } : undefined}
                        >
                          <Text
                            className={`text-xs font-semibold ${
                              active ? "text-primary-foreground" : "text-muted-foreground"
                            }`}
                          >
                            {c.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {confirmed ? (
                    <Text className="mt-2 text-xs text-muted-foreground">
                      La compra está confirmada: la frecuencia ya no se puede cambiar este mes.
                    </Text>
                  ) : generate.isPending ? (
                    <Text className="mt-2 text-xs text-muted-foreground">
                      Recolocando la compra y los platos...
                    </Text>
                  ) : null}
                </View>

                <Text className="px-1 text-xs text-muted-foreground">
                  Precios orientativos de supermercado. Ajusta cantidades a tu casa.
                </Text>

                {trips.map((t) => {
                  const tripTotal = shoppingTotal(t.groups);
                  return (
                    <View key={t.trip} className="rounded-3xl border border-border bg-surface p-5">
                      <View className="flex-row items-baseline justify-between gap-3">
                        <Text className="flex-1 text-sm font-semibold text-foreground">
                          {tripLabel(activeCadence, t.trip)}
                        </Text>
                        <Text className="text-xs font-semibold text-primary">{eur(tripTotal)}</Text>
                      </View>
                      {t.groups.map((group) => (
                        <View key={group.category} className="mt-3">
                          <Text className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {group.category}
                          </Text>
                          <View className="mt-1.5 gap-1.5">
                            {group.items.map((item) => (
                              <View key={item.name} className="flex-row items-baseline gap-2">
                                <View className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
                                <Text className="flex-1 text-sm text-foreground">
                                  {item.name}
                                  {item.qty ? (
                                    <Text className="text-muted-foreground"> · {item.qty}</Text>
                                  ) : null}
                                  {item.perishable ? (
                                    <Text className="text-[11px] font-semibold text-secondary-foreground">
                                      {"  fresco"}
                                    </Text>
                                  ) : null}
                                </Text>
                                <Text className="text-xs text-muted-foreground">
                                  {eur(item.price_eur)}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ))}
                    </View>
                  );
                })}
                {!shopping?.length ? (
                  <Text className="text-sm text-muted-foreground">
                    Aún no hay lista. Regenera el plan para crearla.
                  </Text>
                ) : null}
              </View>
            )}
          </>
        )}
      </ScrollView>

      <BottomNav />
    </SafeAreaView>
  );
}

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

// Calendario del mes con detalle de día en modal, equivalente RN del
// PlanMonthCalendar de la web.
function PlanMonthCalendar({ plan, month }: { plan: MonthlyPlan; month: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const today = todayISO();

  const [year, m] = month.split("-").map(Number);
  const monthIdx = (m ?? 1) - 1;
  const y = year ?? new Date().getFullYear();
  const daysInMonth = new Date(y, monthIdx + 1, 0).getDate();
  const firstOffset = (new Date(y, monthIdx, 1).getDay() + 6) % 7;
  const isoDay = (d: number) => `${month}-${String(d).padStart(2, "0")}`;

  const cells: (string | null)[] = [
    ...Array.from({ length: firstOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDay(i + 1)),
  ];

  const detail = selected ? planForDate(plan, selected) : null;
  const meals = selected ? mealsForDate(plan, selected).filter((meal) => meal.idea) : [];

  return (
    <View className="rounded-3xl border border-border bg-surface p-5">
      <Text className="text-sm font-semibold text-foreground">Calendario del mes</Text>
      <Text className="mt-1 text-xs text-muted-foreground">
        Toca un día para ver su menú completo.
      </Text>

      <View className="mt-4 flex-row flex-wrap">
        {WEEKDAYS.map((d, i) => (
          <View key={`${d}-${i}`} className="items-center py-1" style={{ width: `${100 / 7}%` }}>
            <Text className="text-[11px] font-medium text-muted-foreground">{d}</Text>
          </View>
        ))}
        {cells.map((date, i) => {
          if (!date)
            return <View key={`empty-${i}`} className="p-0.5" style={{ width: `${100 / 7}%` }} />;
          const isWeekend = i % 7 === 5 || i % 7 === 6;
          const isToday = date === today;
          return (
            <View key={date} className="p-0.5" style={{ width: `${100 / 7}%` }}>
              <Pressable
                onPress={() => setSelected(date)}
                className={`aspect-square items-center justify-center rounded-xl border active:opacity-80 ${
                  isWeekend ? "border-accent bg-accent/40" : "border-border bg-surface"
                } ${isToday ? "border-primary" : ""}`}
                style={isToday ? { borderWidth: 2 } : undefined}
              >
                <Text
                  className={`text-sm ${
                    date < today && !isWeekend ? "text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {Number(date.slice(8, 10))}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <Dialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        title={
          selected
            ? new Date(`${selected}T00:00:00`).toLocaleDateString("es-ES", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })
            : ""
        }
      >
        {detail ? (
          <View className="gap-3">
            <Text className="text-xs text-muted-foreground">
              {detail.week.label} · {detail.week.focus}
            </Text>
            <View className="gap-2">
              {meals.map((meal) => {
                const note = offListNote(meal.off);
                return (
                  <View key={meal.slot} className="rounded-xl border border-border bg-surface p-3">
                    <Text className="text-xs font-semibold text-primary">{meal.moment}</Text>
                    <Text className="mt-1 text-sm text-foreground">{meal.idea}</Text>
                    {note ? (
                      <View className="mt-1.5 self-start rounded-full bg-warning/20 px-2 py-0.5">
                        <Text className="text-[11px] font-medium text-foreground">{note}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ) : (
          <Text className="text-sm text-muted-foreground">
            Este día todavía no tiene menú en el plan.
          </Text>
        )}
      </Dialog>
    </View>
  );
}
