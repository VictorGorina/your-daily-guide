import {
  CalendarSync,
  Carrot,
  Check,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Plus,
  Receipt,
  ShoppingCart,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";

import { isCleanFood } from "../../lib/content-guard";
import { freshRisksForTrip, freshRiskText } from "../../lib/perishability";
import {
  clearPlanUpdatedNotice,
  hasPlanUpdatedNotice,
  onPlanRecalcDone,
} from "../../lib/plan-recalc";
import {
  boughtTotal,
  CADENCES,
  homeTotal,
  pendingTotal,
  shoppingTotal,
  tripDayRange,
  tripTiming,
  type PantryExtra,
  type PlanCoverage,
  type PlanMonthStatus,
  type ShoppingCadence,
  type ShoppingList,
} from "../../lib/plan-shared";
import { useMoney } from "../../lib/use-money";
import { PlanUpdatedBanner } from "../plan-updated-banner";
import { CategoryIcon, FULL_COVERAGE, ProgressFill, type TripGroups } from "./shopping-bits";

/**
 * Tarjeta "Ya lo tengo en casa (fuera del plan)": la persona añade ingredientes
 * que ya tiene y que la lista de la compra no incluye. El planificador los
 * cuenta como disponibles al recolocar (no se añaden a la compra). Copia del
 * `PantryExtrasCard` de la web.
 */
function PantryExtrasCard({
  extras,
  pantry,
}: {
  extras: PantryExtra[];
  pantry: {
    isPending: boolean;
    mutate: (v: { name: string; qty?: string; remove?: boolean }) => void;
  };
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  // Esta tarjeta no enseña el error de la mutación: sin este aviso, un
  // ingrediente rechazado por el servidor desaparecía sin decir nada.
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed || pantry.isPending) return;
    if (!isCleanFood(trimmed)) {
      setError(t("food.blocked"));
      return;
    }
    setError(null);
    pantry.mutate({ name: trimmed });
    setName("");
  };
  return (
    <View className="mt-1 rounded-3xl bg-surface px-4 py-3.5">
      <View className="flex-row items-center gap-2">
        <Carrot size={15} color="#a84a17" />
        <Text className="flex-1 text-[12.5px] font-sans-semibold text-foreground">
          {t("shopping.pantry.title")}
        </Text>
      </View>
      <Text className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
        {t("shopping.pantry.body")}
      </Text>
      <View className="mt-2.5 flex-row gap-1.5">
        <TextInput
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (error) setError(null);
          }}
          onSubmitEditing={add}
          placeholder={t("shopping.pantry.placeholder")}
          accessibilityLabel={t("shopping.pantry.inputLabel")}
          placeholderTextColor="#a89f92"
          className="min-w-0 flex-1 rounded-full bg-secondary px-3.5 py-2 text-xs text-foreground"
        />
        <Pressable
          onPress={add}
          disabled={pantry.isPending || !name.trim()}
          accessibilityRole="button"
          accessibilityLabel={t("shopping.pantry.add")}
          hitSlop={4}
          className="h-9 w-9 items-center justify-center rounded-full bg-foreground active:opacity-80"
          style={pantry.isPending || !name.trim() ? { opacity: 0.4 } : undefined}
        >
          <Plus size={16} color="#f3f1ed" />
        </Pressable>
      </View>
      {error ? <Text className="mt-2 text-[11.5px] text-destructive">{error}</Text> : null}
      {extras.length ? (
        <View className="mt-2.5 flex-row flex-wrap gap-1.5">
          {extras.map((e) => (
            <View
              key={e.name}
              className="flex-row items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1"
            >
              <Text className="text-[11.5px] text-foreground">{e.name}</Text>
              {e.source === "receipt" ? <Receipt size={12} color="#6b6256" /> : null}
              <Pressable
                onPress={() => pantry.mutate({ name: e.name, remove: true })}
                disabled={pantry.isPending}
                accessibilityRole="button"
                accessibilityLabel={t("common.removeNamed", { what: e.name })}
                hitSlop={6}
              >
                <X size={12} color="#6b6256" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pestaña Ingredientes — una compra a la vez, un solo gesto por ingrediente y
// filtros por chip. Portada del rediseño web (src/routes/_authenticated/plan.tsx).
// ---------------------------------------------------------------------------
export function IngredientsTab({
  shopping,
  currentTrip,
  spendBars,
  tripsTotal,
  activeCadence,
  coverage,
  todayDayOfMonth,
  selectedTrip,
  setSelectedTrip,
  filter,
  setFilter,
  recadence,
  pendingCadence,
  setPendingCadence,
  onToggle,
  pantryExtras,
  pantry,
  month,
  monthStatus,
  readOnly,
  tripActual,
  periodBudget,
  overBudget,
  plannerLocked = false,
  plannerName,
  onEnterShopMode,
}: {
  shopping: ShoppingList | null;
  currentTrip: TripGroups | undefined;
  /** Mini gráfico del selector de cadencia: una barra por compra (`tripSpendBars`). */
  spendBars: { days: number; pct: number }[];
  tripsTotal: number;
  activeCadence: ShoppingCadence;
  pendingCadence: ShoppingCadence | null;
  coverage: PlanCoverage | undefined;
  todayDayOfMonth: number;
  selectedTrip: number;
  setSelectedTrip: (t: number) => void;
  filter: "need" | "have" | "all";
  setFilter: (f: "need" | "have" | "all") => void;
  recadence: { isPending: boolean; mutate: (c: ShoppingCadence) => void };
  setPendingCadence: (c: ShoppingCadence) => void;
  onToggle: (itemName: string, next: "fridge" | "store" | null) => void;
  pantryExtras: PantryExtra[];
  pantry: {
    isPending: boolean;
    mutate: (v: { name: string; qty?: string; remove?: boolean }) => void;
  };
  month: string;
  monthStatus: PlanMonthStatus;
  readOnly: boolean;
  /** Gasto real registrado para la compra seleccionada (o undefined). */
  tripActual: number | undefined;
  periodBudget: number;
  overBudget: boolean;
  /** Lista de la casa vista por un no planificador (issue 06): se puede marcar
   *  y comprar, pero no regenerar ni cambiar la cadencia. */
  plannerLocked?: boolean;
  plannerName?: string;
  /** Si se pasa, el `IngredientsTab` muestra su propio CTA "Ir a comprar" en
   *  línea (para la vista con dos listas apiladas). */
  onEnterShopMode?: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const timing = tripTiming(tripsTotal, selectedTrip, todayDayOfMonth, coverage);

  // Aviso de "hemos actualizado tus cantidades" tras un cambio en la mesa. Se
  // suscribe aquí y no en la pantalla de arriba porque `onPlanRecalcDone` es una
  // suscripción de módulo: evita bajar dos props por los tres sitios donde se
  // usa esta pestaña. Igual que en la web.
  const [planUpdated, setPlanUpdated] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void hasPlanUpdatedNotice(month).then((v) => {
        if (alive) setPlanUpdated(v);
      });
    };
    refresh();
    const off = onPlanRecalcDone((done) => {
      if (done === month) refresh();
    });
    return () => {
      alive = false;
      off();
    };
  }, [month]);
  const dismissPlanUpdated = () => {
    clearPlanUpdatedNotice(month);
    setPlanUpdated(false);
  };

  // Mes que viene desbloqueado: la compra se hace entera ahora. Mes pasado: solo
  // lectura. Mes en curso: cualquier compra que no haya pasado ya (puedes
  // auditar la nevera para la semana que viene por adelantado); las compras ya
  // pasadas quedan bloqueadas.
  const editable = readOnly
    ? false
    : monthStatus === "next-unlocked" || (monthStatus === "current" && timing !== "past");

  // Cifras de la tarjeta "Te falta comprar": de la compra seleccionada, no del
  // mes (diseño 1c: "el número con el que sales de casa").
  const tripGroups = currentTrip?.groups ?? [];
  const total = shoppingTotal(tripGroups);
  const alreadyHome = homeTotal(tripGroups);
  const alreadyBought = boughtTotal(tripGroups);
  const stillPending = pendingTotal(tripGroups);

  // Items de esta compra, filtrados por el chip activo
  const filteredGroups = useMemo(() => {
    if (!currentTrip) return [];
    return currentTrip.groups
      .map((g) => ({
        category: g.category,
        items: g.items.filter((i) => {
          if (filter === "need") return !i.owned;
          if (filter === "have") return !!i.owned;
          return true;
        }),
      }))
      .filter((g) => g.items.length);
  }, [currentTrip, filter]);

  const totalItems = currentTrip?.groups.reduce((s, g) => s + g.items.length, 0) ?? 0;
  const needCount =
    currentTrip?.groups.reduce((s, g) => s + g.items.filter((i) => !i.owned).length, 0) ?? 0;
  const haveCount = totalItems - needCount;
  const pctResolved = totalItems > 0 ? Math.round((haveCount / totalItems) * 100) : 0;

  const tripRange = tripDayRange(coverage ?? FULL_COVERAGE, tripsTotal, selectedTrip);
  const monthShort = t(`monthsShort.${Number(month.slice(5, 7)) - 1}`);
  const tripLabel =
    activeCadence === "mensual"
      ? t("shopping.tripSingle")
      : t("shopping.tripOf", { n: selectedTrip + 1, total: tripsTotal });

  // Frescos que esta compra no cubre sin que se estropeen: no cambia la lista,
  // solo avisa de comprarlos más cerca de cuando se cocinan.
  const freshRisks = freshRisksForTrip(
    tripGroups,
    coverage ?? FULL_COVERAGE,
    tripsTotal,
    selectedTrip,
  );

  const barHome = total > 0 ? (alreadyHome / total) * 100 : 0;
  const barBought = total > 0 ? (alreadyBought / total) * 100 : 0;

  // La cadencia que enseña el selector: la recién pulsada mientras se guarda.
  const shownCadence =
    CADENCES.find((c) => c.key === (pendingCadence ?? activeCadence)) ?? CADENCES[0];

  return (
    <View className="mt-5 gap-2.5">
      {/* "Tus ingredientes se han actualizado": la mesa cambió y el recálculo
          automático ya rehizo las cantidades. Va aquí y no en Familia porque es
          aquí donde se ven los números distintos. */}
      {planUpdated ? <PlanUpdatedBanner onDismiss={dismissPlanUpdated} /> : null}
      {readOnly ? (
        <View className="rounded-[20px] bg-secondary/60 px-4 py-3">
          <Text className="text-xs leading-relaxed text-muted-foreground">
            {t("shopping.readOnly")}
          </Text>
        </View>
      ) : plannerLocked ? null : (
        /* Cadencia */
        <View className="rounded-3xl bg-surface p-4">
          <View className="flex-row items-center gap-2 px-0.5">
            <CalendarSync size={15} color="#a84a17" />
            <Text className="flex-1 text-sm font-sans-semibold text-foreground">
              {t("shopping.cadenceTitle")}
            </Text>
          </View>
          <View className="mt-2.5 flex-row gap-0.5 rounded-full bg-secondary p-[3px]">
            {CADENCES.map((c) => {
              const active = shownCadence.key === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => {
                    if (recadence.isPending || c.key === activeCadence) return;
                    setPendingCadence(c.key);
                    recadence.mutate(c.key);
                  }}
                  disabled={recadence.isPending}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className={`flex-1 items-center rounded-full py-2 active:opacity-80 ${
                    active ? "bg-surface" : ""
                  }`}
                  style={[
                    active && {
                      shadowColor: "#3e3d39",
                      shadowOpacity: 0.12,
                      shadowRadius: 2,
                      shadowOffset: { width: 0, height: 1 },
                    },
                    recadence.isPending && { opacity: 0.6 },
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    className={`text-xs font-sans-semibold ${
                      active ? "text-primary-ink" : "text-muted-foreground"
                    }`}
                  >
                    {t(`cadence.${c.key}.short`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* Reparto del mes: una barra por compra, tan ancha como los días
              que cubre y tan alta como los euros que cuesta. */}
          <View className="mt-3 flex-row items-center gap-3 px-0.5">
            <View className="h-[30px] w-16 flex-row items-end gap-[3px]">
              {spendBars.map((bar, i) => (
                <View
                  key={i}
                  className="rounded bg-primary"
                  style={{ flex: bar.days, height: `${bar.pct}%`, minHeight: 4 }}
                />
              ))}
            </View>
            <Text className="flex-1 text-[12.5px] leading-[18px] text-muted-foreground">
              {recadence.isPending ? (
                t("shopping.updating")
              ) : (
                <>
                  <Text className="font-sans-semibold text-foreground">
                    {t("shopping.trips", { count: tripsTotal })}
                  </Text>{" "}
                  {t(`cadence.${shownCadence.key}.desc`)}
                </>
              )}
            </Text>
          </View>
        </View>
      )}

      {/* Aviso de presupuesto: es del mes entero, no de una compra. */}
      {overBudget ? (
        <View className="rounded-3xl bg-destructive/10 px-4 py-3">
          <Text className="text-xs leading-relaxed text-destructive">
            {t("shopping.overBudget", { budget: money(periodBudget) })}
          </Text>
        </View>
      ) : null}

      {/* Navegador de compra ← → */}
      {tripsTotal > 1 ? (
        <View className="flex-row items-center gap-2 rounded-full bg-secondary/60 p-1">
          <Pressable
            onPress={() => setSelectedTrip(Math.max(0, selectedTrip - 1))}
            disabled={selectedTrip === 0}
            accessibilityRole="button"
            accessibilityLabel={t("shopping.previousTrip")}
            className="h-[30px] w-[30px] items-center justify-center rounded-full bg-surface active:opacity-70"
            style={selectedTrip === 0 ? { opacity: 0.4 } : undefined}
          >
            <ChevronLeft size={14} color="#6b6256" />
          </Pressable>
          <View className="min-w-0 flex-1 items-center">
            <Text className="text-[12.5px] font-sans-semibold text-foreground">
              {monthStatus === "current" && timing === "current"
                ? t("shopping.thisWeek", { trip: tripLabel })
                : tripLabel}
            </Text>
            <Text className="font-mono text-[10px] text-muted-foreground">
              {tripRange.from} – {tripRange.to} {monthShort}
            </Text>
          </View>
          <Pressable
            onPress={() => setSelectedTrip(Math.min(tripsTotal - 1, selectedTrip + 1))}
            disabled={selectedTrip === tripsTotal - 1}
            accessibilityRole="button"
            accessibilityLabel={t("shopping.nextTrip")}
            className="h-[30px] w-[30px] items-center justify-center rounded-full bg-surface active:opacity-70"
            style={selectedTrip === tripsTotal - 1 ? { opacity: 0.4 } : undefined}
          >
            <ChevronRight size={14} color="#6b6256" />
          </Pressable>
        </View>
      ) : null}

      {/* Resumen "Te falta comprar" */}
      <View className="rounded-3xl bg-surface p-5">
        <Text className="text-xs font-sans-semibold text-muted-foreground">
          {t("shopping.pending")}
        </Text>
        <View className="mt-0.5 flex-row items-baseline gap-2">
          <Text className="font-heading text-4xl tabular-nums text-primary-ink">
            {money(stillPending)}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {t("shopping.items", { count: needCount })}
          </Text>
        </View>
        <View className="mt-3.5 h-2 flex-row overflow-hidden rounded-full bg-secondary">
          <ProgressFill pct={barHome} color="#4cae64" />
          <ProgressFill pct={barBought} color="rgba(76,174,100,0.5)" />
        </View>
        <View className="mt-2.5 flex-row flex-wrap gap-3">
          <View className="flex-row items-center gap-1.5">
            <View className="h-[7px] w-[7px] rounded-full bg-success" />
            <Text className="text-[11.5px] text-muted-foreground">
              {t("shopping.atHome")} {money(alreadyHome)}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="h-[7px] w-[7px] rounded-full bg-success/50" />
            <Text className="text-[11.5px] text-muted-foreground">
              {t("shopping.bought")} {money(alreadyBought)}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="h-[7px] w-[7px] rounded-full bg-secondary" />
            <Text className="text-[11.5px] text-muted-foreground">
              {t("shopping.total")} {money(total)}
            </Text>
          </View>
        </View>
        {tripActual != null ? (
          <Text className="mt-2 text-xs text-muted-foreground">
            {t("shopping.spentOnTrip")}{" "}
            <Text className="font-sans-semibold text-foreground">{money(tripActual)}</Text>
            {tripActual !== total ? (
              <Text className={tripActual > total ? "text-destructive" : "text-success"}>
                {" "}
                {t("shopping.vsEstimate", {
                  diff: `${tripActual > total ? "+" : ""}${money(tripActual - total)}`,
                })}
              </Text>
            ) : null}
          </Text>
        ) : null}
      </View>

      {/* Aviso de frescura: frescos que no aguantan los días de esta compra. */}
      {freshRisks.length ? (
        <View className="rounded-3xl bg-warning/20 px-4 py-3">
          <Text className="text-xs leading-relaxed text-foreground">
            {freshRiskText(freshRisks, tripRange.to - tripRange.from + 1, activeCadence, t)}
          </Text>
        </View>
      ) : null}

      {/* Cabecera + filtros */}
      <View className="mt-1 flex-row items-center justify-between gap-2.5 px-0.5">
        <Text className="font-heading text-xl text-foreground">{t("shopping.title")}</Text>
        <Text className="text-[11.5px] text-muted-foreground">
          {t("shopping.resolved", { pct: pctResolved })}
        </Text>
      </View>
      <Text className="px-0.5 text-xs leading-relaxed text-muted-foreground">
        <Trans i18nKey="shopping.help" components={{ b: <Text /> }} />
      </Text>

      <View className="flex-row gap-1.5">
        {(
          [
            ["all", t("shopping.filters.all"), totalItems],
            ["need", t("shopping.filters.need"), needCount],
            ["have", t("shopping.filters.have"), haveCount],
          ] as const
        ).map(([key, chipLabel, count]) => {
          const active = filter === key;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={key}
              onPress={() => setFilter(key)}
              className={`flex-row items-center gap-1.5 rounded-full px-3 py-2 active:opacity-80 ${
                active ? "bg-foreground" : "bg-secondary"
              }`}
            >
              <Text
                className={`text-xs font-sans-semibold ${
                  active ? "text-background" : "text-muted-foreground"
                }`}
              >
                {chipLabel}
              </Text>
              <Text
                className={`font-mono text-[11px] ${active ? "text-background" : "text-muted-foreground"}`}
              >
                {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Grupos de categoría */}
      <View className="gap-2.5">
        {filteredGroups.map((g) => (
          <View key={g.category} className="rounded-3xl bg-surface px-4 pb-1.5 pt-3.5">
            <View className="flex-row items-center gap-2 pb-1.5">
              <CategoryIcon category={g.category} />
              <Text className="flex-1 text-[11px] font-sans-bold uppercase tracking-wide text-muted-foreground">
                {g.category}
              </Text>
              <Text className="font-mono text-[11px] text-muted-foreground">{g.items.length}</Text>
            </View>
            {g.items.map((item, i) => {
              const have = !!item.owned;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={`${item.name}-${i}`}
                  onPress={() => {
                    if (!editable) return;
                    onToggle(item.name, item.owned ? null : "fridge");
                  }}
                  className={`flex-row items-center gap-3 border-t border-secondary py-2.5 ${
                    editable ? "active:opacity-60" : ""
                  }`}
                >
                  <View
                    className={`h-[26px] w-[26px] items-center justify-center rounded-full ${
                      have ? "bg-success" : "border-[1.5px] border-border"
                    }`}
                  >
                    {have ? <Check size={14} color="#fbfaf7" /> : null}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text
                      className={`text-[14.5px] font-sans-medium ${
                        have ? "text-muted-foreground line-through" : "text-foreground"
                      }`}
                    >
                      {item.name}
                    </Text>
                    {item.qty ? (
                      <Text className="font-mono text-[10.5px] text-muted-foreground">
                        {item.qty}
                      </Text>
                    ) : null}
                  </View>
                  <View className="items-end">
                    <Text className="font-mono text-xs text-muted-foreground">
                      {money(item.price_eur)}
                    </Text>
                    {have ? (
                      <Text className="text-[10px] font-sans-semibold text-success">
                        {item.owned === "store" ? t("shopping.bought") : t("shopping.atHome")}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        {!shopping?.length ? (
          <Text className="text-sm text-muted-foreground">
            {readOnly
              ? t("shopping.empty.past")
              : plannerLocked
                ? t("shopping.empty.house", {
                    name: plannerName ?? t("shopping.plannerFallback"),
                  })
                : t("shopping.empty.own")}
          </Text>
        ) : filteredGroups.length === 0 ? (
          <Text className="px-0.5 text-sm text-muted-foreground">
            {t(`shopping.emptyFilter.${filter}`)}
          </Text>
        ) : null}
      </View>

      {/* Ya tengo en casa fuera del plan */}
      {readOnly ? null : <PantryExtrasCard extras={pantryExtras} pantry={pantry} />}

      {/* Tip de persistencia */}
      {readOnly ? null : (
        <View className="mt-1 flex-row items-start gap-2.5 rounded-3xl bg-primary/10 px-4 py-3.5">
          <Lightbulb size={15} color="#a84a17" style={{ marginTop: 2 }} />
          <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
            {t("shopping.tip")}
          </Text>
        </View>
      )}

      {/* CTA "Ir a comprar" en línea — para la vista con dos listas apiladas
          (compra de la casa + compra en solitario); en la vista de una sola
          lista el CTA lo pinta la pantalla, fijo al fondo. */}
      {onEnterShopMode && editable && (shopping?.length ?? 0) > 0 && needCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={onEnterShopMode}
          className="mt-1 flex-row items-center justify-center gap-2 rounded-[20px] bg-primary py-4 active:opacity-90"
        >
          <ShoppingCart size={17} color="#3e3d39" />
          <Text className="text-sm font-sans-bold text-primary-foreground">
            {t("shopping.goShop", { count: needCount })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
