import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import {
  Check,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Lock,
  RefreshCw,
  Share2,
  ShoppingBasket,
  Sparkles,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { HistorialSection } from "../../components/historial-section";
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
  ownedTotal,
  planForDate,
  shoppingToText,
  shoppingTotal,
  splitOwned,
  tripActualsTotal,
  tripLabel,
  type MonthlyPlan,
  type ShoppingCadence,
  type ShoppingItem,
  type ShoppingList,
  type TripActuals,
} from "../../lib/plan-shared";

type GenerateResult = { plan: MonthlyPlan; shopping: ShoppingList };

export default function Plan() {
  const qc = useQueryClient();
  const month = monthISO();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<"plan" | "compra" | "historial">(
    params.tab === "compra" || params.tab === "historial" ? params.tab : "plan",
  );
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

  const owned = useMutation({
    mutationFn: (vars: { itemName: string; owned: boolean }) =>
      apiPost<{ shopping: ShoppingList }>("plan/shopping-owned", { month, ...vars }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, shopping: res.shopping } : prev,
      );
    },
    onError: () => Alert.alert("No hemos podido guardar el cambio"),
  });

  const setActual = useMutation({
    mutationFn: (vars: { trip: number; amount: number | null }) =>
      apiPost<{ trip_actuals: TripActuals }>("plan/trip-actual", { month, ...vars }),
    onSuccess: (res) => {
      qc.setQueryData(["plan", month], (prev: typeof planQ.data) =>
        prev ? { ...prev, trip_actuals: res.trip_actuals } : prev,
      );
    },
    onError: () => Alert.alert("No hemos podido guardar el gasto"),
  });

  const plan = planQ.data?.plan ?? null;
  const shopping = planQ.data?.shopping ?? null;
  const confirmed = Boolean(planQ.data?.confirmed_at);
  const total = shoppingTotal(shopping);
  const alreadyOwned = ownedTotal(shopping);
  const tripActuals = planQ.data?.trip_actuals ?? {};
  const spentSoFar = tripActualsTotal(tripActuals);
  const hasActuals = Object.keys(tripActuals).length > 0;
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
            <Text className="text-xs font-sans-medium uppercase tracking-wide text-muted-foreground">
              Plan mensual
            </Text>
            <Text className="font-heading text-3xl capitalize text-foreground" numberOfLines={1}>
              {monthLabel}
            </Text>
          </View>
          {plan && !confirmed ? (
            <Pressable
              onPress={() => generate.mutate(undefined)}
              disabled={generate.isPending}
              className="mt-1 h-11 w-11 items-center justify-center rounded-full bg-surface active:opacity-70"
              style={generate.isPending ? { opacity: 0.6 } : undefined}
            >
              {generate.isPending ? (
                <ActivityIndicator size="small" color="#83796c" />
              ) : (
                <RefreshCw size={18} color="#83796c" />
              )}
            </Pressable>
          ) : null}
        </View>

        {!plan ? (
          <View className="mt-8 items-center rounded-3xl bg-surface p-6">
            <CalendarRange size={28} color="#6dbe7b" />
            <Text className="mt-3 text-sm font-sans-semibold text-foreground">
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
              <Text className="text-sm font-sans-semibold text-primary-foreground">
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
                  ["compra", "Compra", ShoppingBasket],
                  ["historial", "Historial", CalendarDays],
                ] as const
              ).map(([key, label, Icon]) => {
                const active = tab === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setTab(key)}
                    className={`flex-1 flex-row items-center justify-center gap-1 rounded-full py-2.5 active:opacity-80 ${
                      active ? "bg-surface" : ""
                    }`}
                  >
                    <Icon size={14} color={active ? "#6dbe7b" : "#83796c"} />
                    <Text
                      className={`text-xs font-sans-medium ${active ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {tab === "plan" ? (
              <View className="mt-5 gap-5">
                <View className="rounded-3xl bg-surface p-5">
                  <View className="flex-row items-center gap-2">
                    <Sparkles size={16} color="#6dbe7b" />
                    <Text className="text-sm font-sans-semibold text-foreground">
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
            ) : tab === "historial" ? (
              <HistorialSection />
            ) : (
              <View className="mt-5 gap-4">
                <View className="rounded-3xl bg-surface p-5">
                  <View className="flex-row items-baseline justify-between gap-3">
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-sans-semibold text-foreground">
                        Total orientativo del mes
                      </Text>
                      <Text className="mt-1 text-xs text-muted-foreground">
                        {budget > 0
                          ? `Tu presupuesto: ${eur(budget)}`
                          : "Sin presupuesto definido en tu perfil"}
                      </Text>
                    </View>
                    <Text
                      className={`font-heading text-2xl tabular-nums ${overBudget ? "text-destructive" : "text-primary"}`}
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
                  {alreadyOwned > 0 ? (
                    <Text className="mt-2 text-xs text-muted-foreground">
                      Ya tienes {eur(alreadyOwned)} en casa · Te falta comprar{" "}
                      {eur(Math.max(0, total - alreadyOwned))}
                    </Text>
                  ) : null}
                  {confirmed && hasActuals ? (
                    <Text className="mt-2 text-xs text-muted-foreground">
                      Gasto real hasta ahora:{" "}
                      <Text className="font-sans-semibold text-foreground">{eur(spentSoFar)}</Text>
                      {spentSoFar !== total ? (
                        <Text className={spentSoFar > total ? "text-destructive" : "text-success"}>
                          {" "}
                          ({spentSoFar > total ? "+" : ""}
                          {eur(spentSoFar - total)} vs. lo estimado)
                        </Text>
                      ) : null}
                    </Text>
                  ) : null}
                  {overBudget ? (
                    <Text className="mt-2 text-xs text-destructive">
                      Se pasa de tu presupuesto. Puedo ajustarlo: regenera el plan o dímelo en el
                      chat.
                    </Text>
                  ) : null}

                  {confirmed ? (
                    <View className="mt-4 flex-row items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2.5">
                      <Lock size={14} color="#83796c" />
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
                      <CheckCircle2 size={16} color="#3e3d39" />
                      <Text className="text-sm font-sans-semibold text-primary-foreground">
                        {lock.isPending ? "Confirmando..." : "Ya he comprado esto"}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {shopping?.length ? (
                  <Pressable
                    onPress={() => void shareList()}
                    className="flex-row items-center justify-center gap-2 rounded-2xl bg-surface py-3.5 active:opacity-80"
                  >
                    <Share2 size={16} color="#6dbe7b" />
                    <Text className="text-sm font-sans-semibold text-foreground">
                      Compartir la lista
                    </Text>
                  </Pressable>
                ) : null}

                <View className="rounded-3xl bg-surface p-5">
                  <Text className="text-sm font-sans-semibold text-foreground">
                    Cada cuánto compras
                  </Text>
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
                          className={`flex-1 items-center rounded-2xl px-2 py-2.5 active:opacity-80 ${
                            active ? "bg-primary" : "bg-secondary"
                          }`}
                          style={disabled ? { opacity: 0.6 } : undefined}
                        >
                          <Text
                            className={`text-xs font-sans-semibold ${
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

                {trips.map((t) => (
                  <TripCard
                    key={t.trip}
                    trip={t}
                    label={tripLabel(activeCadence, t.trip)}
                    confirmed={confirmed}
                    tripActual={tripActuals[t.trip]}
                    savingActual={setActual.isPending}
                    onSaveActual={(amount) => setActual.mutate({ trip: t.trip, amount })}
                    onToggleOwned={(itemName, nextOwned) =>
                      owned.mutate({ itemName, owned: nextOwned })
                    }
                  />
                ))}
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
    <View className="rounded-3xl bg-surface p-5">
      <Text className="text-sm font-sans-semibold text-foreground">Calendario del mes</Text>
      <Text className="mt-1 text-xs text-muted-foreground">
        Toca un día para ver su menú completo.
      </Text>

      <View className="mt-4 flex-row flex-wrap">
        {WEEKDAYS.map((d, i) => (
          <View key={`${d}-${i}`} className="items-center py-1" style={{ width: `${100 / 7}%` }}>
            <Text className="text-[11px] font-sans-medium text-muted-foreground">{d}</Text>
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
                className={`aspect-square items-center justify-center rounded-xl active:opacity-80 ${
                  isWeekend ? "bg-accent/60" : "bg-secondary"
                } ${isToday ? "border-2 border-primary" : ""}`}
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
                  <View key={meal.slot} className="rounded-xl bg-secondary p-3">
                    <Text className="text-xs font-sans-semibold text-primary">{meal.moment}</Text>
                    <Text className="mt-1 text-sm text-foreground">{meal.idea}</Text>
                    {note ? (
                      <View className="mt-1.5 self-start rounded-full bg-warning/20 px-2 py-0.5">
                        <Text className="text-[11px] font-sans-medium text-foreground">{note}</Text>
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

/**
 * Campo para anotar lo que se ha gastado de verdad en un viaje de compra, aparte
 * del precio estimado por la IA. Guarda al perder el foco (no en cada tecla) y
 * muestra la diferencia contra lo estimado cuando hay un importe guardado.
 */
function TripActualField({
  value,
  estimated,
  saving,
  onSave,
}: {
  value: number | undefined;
  estimated: number;
  saving: boolean;
  onSave: (amount: number | null) => void;
}) {
  const [text, setText] = useState(value != null ? String(value) : "");

  useEffect(() => {
    setText(value != null ? String(value) : "");
  }, [value]);

  const commit = () => {
    const trimmed = text.trim().replace(",", ".");
    if (!trimmed) {
      if (value != null) onSave(null);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0 && n !== value) onSave(Math.round(n * 100) / 100);
  };

  const diff = value != null ? Math.round((value - estimated) * 100) / 100 : null;

  return (
    <View className="mt-3 flex-row items-center gap-2 rounded-2xl bg-secondary/40 px-3 py-2.5">
      <Text className="flex-1 text-xs text-muted-foreground">¿Cuánto gastaste?</Text>
      <View className="flex-row items-center gap-1">
        <TextInput
          value={text}
          onChangeText={setText}
          onBlur={commit}
          placeholder={eur(estimated)}
          keyboardType="decimal-pad"
          editable={!saving}
          className="w-20 rounded-lg bg-surface px-2 py-1.5 text-right text-sm text-foreground"
          style={saving ? { opacity: 0.6 } : undefined}
        />
        <Text className="text-xs text-muted-foreground">€</Text>
      </View>
      {diff != null && diff !== 0 ? (
        <Text
          className={`text-xs font-sans-semibold ${diff > 0 ? "text-destructive" : "text-success"}`}
        >
          {diff > 0 ? "+" : ""}
          {eur(diff)}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Tarjeta de una compra: separa lo pendiente de comprar (arriba, agrupado por
 * categoría como en el súper) de lo ya marcado como "en casa" (abajo, oculto
 * por defecto), para que de un vistazo se sepa qué falta de verdad.
 */
function TripCard({
  trip,
  label,
  confirmed,
  tripActual,
  savingActual,
  onSaveActual,
  onToggleOwned,
}: {
  trip: { trip: number; groups: { category: string; items: ShoppingItem[] }[] };
  label: string;
  confirmed: boolean;
  tripActual: number | undefined;
  savingActual: boolean;
  onSaveActual: (amount: number | null) => void;
  onToggleOwned: (itemName: string, owned: boolean) => void;
}) {
  const [ownedOpen, setOwnedOpen] = useState(false);
  const tripTotal = shoppingTotal(trip.groups);
  const { pending, owned } = splitOwned(trip.groups);
  const pendingCount = pending.reduce((s, g) => s + g.items.length, 0);
  const ownedCount = owned.reduce((s, g) => s + g.items.length, 0);

  return (
    <View className="rounded-3xl bg-surface p-5">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="flex-1 text-sm font-sans-semibold text-foreground">{label}</Text>
        <Text className="text-xs font-sans-semibold text-primary">{eur(tripTotal)}</Text>
      </View>
      {ownedCount > 0 ? (
        <Text className="mt-1 text-xs text-muted-foreground">
          {pendingCount > 0
            ? `Te falta comprar ${pendingCount} de ${pendingCount + ownedCount}`
            : "Ya tienes todo de esta compra"}
        </Text>
      ) : null}

      {pending.map((group) => (
        <ShoppingGroup key={group.category} group={group} onToggleOwned={onToggleOwned} />
      ))}

      {owned.length ? (
        <View className="mt-4 border-t border-border pt-3">
          <Pressable
            onPress={() => setOwnedOpen((o) => !o)}
            className="flex-row items-center justify-between active:opacity-70"
          >
            <Text className="text-xs font-sans-medium text-muted-foreground">
              Ya en casa ({ownedCount})
            </Text>
            <Text className="text-xs font-sans-medium text-muted-foreground">
              {ownedOpen ? "ocultar" : "ver"}
            </Text>
          </Pressable>
          {ownedOpen
            ? owned.map((group) => (
                <ShoppingGroup key={group.category} group={group} onToggleOwned={onToggleOwned} />
              ))
            : null}
        </View>
      ) : null}

      {confirmed ? (
        <TripActualField
          value={tripActual}
          estimated={tripTotal}
          saving={savingActual}
          onSave={onSaveActual}
        />
      ) : null}
    </View>
  );
}

function ShoppingGroup({
  group,
  onToggleOwned,
}: {
  group: { category: string; items: ShoppingItem[] };
  onToggleOwned: (itemName: string, owned: boolean) => void;
}) {
  return (
    <View className="mt-3">
      <Text className="text-[11px] font-sans-medium uppercase tracking-wide text-muted-foreground">
        {group.category}
      </Text>
      <View className="mt-1.5 gap-1.5">
        {group.items.map((item) => (
          <View key={item.name} className="flex-row items-center gap-2">
            <Pressable
              onPress={() => onToggleOwned(item.name, !item.owned)}
              className={`h-5 w-5 items-center justify-center rounded-full active:opacity-70 ${
                item.owned ? "bg-primary" : "bg-secondary"
              }`}
            >
              {item.owned ? <Check size={12} color="#3e3d39" /> : null}
            </Pressable>
            <Text
              className={`flex-1 text-sm ${item.owned ? "text-muted-foreground line-through" : "text-foreground"}`}
            >
              {item.name}
              {item.qty ? <Text className="text-muted-foreground"> · {item.qty}</Text> : null}
              {item.perishable ? (
                <Text className="text-[11px] font-sans-semibold text-secondary-foreground">
                  {"  fresco"}
                </Text>
              ) : null}
            </Text>
            <Text className="text-xs text-muted-foreground">{eur(item.price_eur)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
