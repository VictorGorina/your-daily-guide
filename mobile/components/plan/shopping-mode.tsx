import { Check, ChevronLeft, Receipt } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { freshRisksForTrip, freshRiskText } from "../../lib/perishability";
import { tripDayRange, type PlanCoverage, type ShoppingCadence } from "../../lib/plan-shared";
import { useCurrencySymbol, useMoney } from "../../lib/use-money";
import { CategoryIcon, FULL_COVERAGE, ProgressFill, type TripGroups } from "./shopping-bits";

// ---------------------------------------------------------------------------
// Modo compra — pantalla completa solo con lo que falta coger en el súper.
// ---------------------------------------------------------------------------
export function ShoppingMode({
  trip,
  cadence,
  coverage,
  tripsTotal,
  selectedTrip,
  month,
  onToggle,
  onClose,
  tripActual,
  savingActual,
  onSaveActual,
  onScanReceipt,
  scanningReceipt,
}: {
  trip: TripGroups | undefined;
  cadence: ShoppingCadence;
  coverage: PlanCoverage | undefined;
  tripsTotal: number;
  selectedTrip: number;
  month: string;
  onToggle: (itemName: string, next: "store" | null) => void;
  onClose: () => void;
  tripActual: number | undefined;
  savingActual: boolean;
  onSaveActual: (amount: number | null) => void;
  onScanReceipt: (imageBase64: string, mime: string) => void;
  scanningReceipt: boolean;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const currencySign = useCurrencySymbol();
  const [text, setText] = useState(tripActual != null ? String(tripActual) : "");

  // Deja elegir foto (galería o cámara), la reescala a ~1280 px JPEG y la manda
  // al servidor como base64. Necesita el módulo nativo `expo-image-picker`: hasta
  // el próximo build nativo el botón avisa en vez de fallar.
  const pickReceipt = async () => {
    try {
      const ImagePicker = await import("expo-image-picker");
      const ImageManipulator = await import("expo-image-manipulator");
      // Sin pedir permiso de fotos: desde iOS 14 el selector del sistema corre
      // fuera de la app y solo entrega la imagen elegida (ticket 38, MOB-17).
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const shrunk = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.72, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (shrunk.base64) onScanReceipt(shrunk.base64, "image/jpeg");
    } catch (e) {
      Alert.alert(t("shopMode.scanUnavailable"));
      console.warn("pickReceipt", e);
    }
  };

  // El modo compra no muestra lo que ya se tenía en casa (nevera): solo lo que
  // hay que coger o lo que se acaba de meter en el carro en esta sesión.
  const shopGroups = useMemo(() => {
    if (!trip) return [];
    return trip.groups
      .map((g) => ({
        category: g.category,
        items: g.items.filter((i) => i.owned !== "fridge"),
      }))
      .filter((g) => g.items.length);
  }, [trip]);

  const allItems = shopGroups.flatMap((g) => g.items);
  const leftItems = allItems.filter((i) => !i.owned);
  const leftTotal = Math.round(leftItems.reduce((s, i) => s + i.price_eur, 0) * 100) / 100;
  const doneTotal =
    Math.round(
      allItems.filter((i) => i.owned === "store").reduce((s, i) => s + i.price_eur, 0) * 100,
    ) / 100;
  const pct = allItems.length ? ((allItems.length - leftItems.length) / allItems.length) * 100 : 0;
  const allDone = allItems.length > 0 && leftItems.length === 0;

  const tripRange = tripDayRange(coverage ?? FULL_COVERAGE, tripsTotal, selectedTrip);
  const freshRisks = trip
    ? freshRisksForTrip(trip.groups, coverage ?? FULL_COVERAGE, tripsTotal, selectedTrip)
    : [];
  const monthShort = t(`monthsShort.${Number(month.slice(5, 7)) - 1}`);

  // Último importe enviado, para que `commitActual` no repita la misma mutación
  // cuando lo disparan seguidos el onBlur del campo y el onPress del botón.
  const savedActual = useRef<number | null | undefined>(tripActual);
  const commitActual = () => {
    const trimmed = text.trim().replace(",", ".");
    if (!trimmed) {
      if (savedActual.current != null) {
        savedActual.current = null;
        onSaveActual(null);
      }
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0 && n !== savedActual.current) {
      const rounded = Math.round(n * 100) / 100;
      savedActual.current = rounded;
      onSaveActual(rounded);
    }
  };

  return (
    // Sustituye la pantalla entera: VoiceOver no debe salir de aquí (A11Y-04).
    <View className="flex-1" accessibilityViewIsModal>
      <ScrollView contentContainerClassName="mx-auto w-full max-w-lg px-5 pt-6 pb-40">
        {/* Cabecera modo compra */}
        <View className="flex-row items-center gap-3">
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("shopMode.exit")}
            hitSlop={4}
            className="h-9 w-9 items-center justify-center rounded-full bg-surface active:opacity-70"
          >
            <ChevronLeft size={16} color="#6b6256" />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="text-[11px] font-sans-semibold uppercase tracking-wide text-muted-foreground">
              {t("shopMode.header", {
                n: selectedTrip + 1,
                total: tripsTotal,
                from: tripRange.from,
                to: tripRange.to,
                month: monthShort,
              })}
            </Text>
            <Text className="font-heading text-2xl text-foreground">{t("shopMode.title")}</Text>
          </View>
        </View>

        {/* Resumen compra */}
        <View className="mt-4 rounded-3xl bg-surface p-5">
          <View className="flex-row items-end justify-between gap-3">
            <View className="min-w-0">
              <Text className="text-xs font-sans-semibold text-muted-foreground">
                {t("shopMode.left")}
              </Text>
              <Text className="mt-0.5 font-heading text-3xl tabular-nums text-primary-ink">
                {money(leftTotal)}
              </Text>
            </View>
            <View className="items-end">
              <Text className="font-mono text-[11px] text-muted-foreground">
                {t("shopMode.inCart")}
              </Text>
              <Text className="mt-0.5 font-mono-medium text-[15px] text-success">
                {money(doneTotal)}
              </Text>
            </View>
          </View>
          <View className="mt-3.5 h-2 overflow-hidden rounded-full bg-secondary">
            <ProgressFill pct={pct} color="#4cae64" rounded />
          </View>
          <Text className="mt-2 text-[11.5px] text-muted-foreground">
            {t("shopMode.progress", { left: leftItems.length, total: allItems.length })}
          </Text>
        </View>

        {freshRisks.length ? (
          <View className="mt-3.5 rounded-2xl bg-warning/20 px-4 py-3">
            <Text className="text-xs leading-relaxed text-foreground">
              {freshRiskText(freshRisks, tripRange.to - tripRange.from + 1, cadence, t, true)}
            </Text>
          </View>
        ) : null}

        {/* Lista de ingredientes agrupados */}
        <View className="mt-3.5 gap-4">
          {shopGroups.map((g) => (
            <View key={g.category}>
              <View className="flex-row items-center gap-2 px-1 pb-2">
                <CategoryIcon category={g.category} />
                <Text className="text-[11px] font-sans-bold uppercase tracking-wide text-muted-foreground">
                  {g.category}
                </Text>
              </View>
              <View className="gap-1.5">
                {g.items.map((item, i) => {
                  const done = item.owned === "store";
                  return (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: done }}
                      key={`${item.name}-${i}`}
                      onPress={() => onToggle(item.name, done ? null : "store")}
                      className={`flex-row items-center gap-3.5 rounded-2xl px-4 py-3.5 active:opacity-80 ${
                        done ? "bg-secondary/50" : "bg-surface"
                      }`}
                    >
                      <View
                        className={`h-7 w-7 items-center justify-center rounded-[9px] ${
                          done ? "bg-success" : "border-[1.5px] border-border"
                        }`}
                      >
                        {done ? <Check size={16} color="#fbfaf7" /> : null}
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text
                          className={`text-base font-sans-semibold ${
                            done ? "text-muted-foreground line-through" : "text-foreground"
                          }`}
                        >
                          {item.name}
                        </Text>
                        <Text className="font-mono text-[11px] text-muted-foreground">
                          {item.qty ? `${item.qty} · ` : ""}
                          {money(item.price_eur)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          {shopGroups.length === 0 ? (
            <Text className="px-1 text-sm text-muted-foreground">{t("shopMode.nothing")}</Text>
          ) : null}
        </View>
      </ScrollView>

      {/* Cierre de la compra — botón fijo al fondo (diseño 1b) */}
      <View className="absolute inset-x-0 bottom-0 border-t border-secondary bg-background px-5 pb-8 pt-3">
        <View className="mx-auto w-full max-w-lg">
          {allDone ? (
            <View className="gap-3">
              <View className="flex-row items-center gap-2 rounded-2xl bg-surface px-4 py-3">
                <Text className="flex-1 text-xs text-muted-foreground">
                  {t("shopMode.spendQuestion")}
                </Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  onBlur={commitActual}
                  placeholder={money(doneTotal)}
                  keyboardType="decimal-pad"
                  editable={!savingActual}
                  className="w-24 rounded-lg bg-secondary px-2 py-1.5 text-right text-sm text-foreground"
                  style={savingActual ? { opacity: 0.6 } : undefined}
                />
                <Text className="text-xs text-muted-foreground">{currencySign}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={pickReceipt}
                disabled={scanningReceipt}
                className="flex-row items-center justify-center gap-2 rounded-2xl border border-secondary py-3 active:opacity-80"
                style={scanningReceipt ? { opacity: 0.6 } : undefined}
              >
                <Receipt size={16} color="#6b6256" />
                <Text className="text-xs font-sans-semibold text-muted-foreground">
                  {scanningReceipt ? t("shopMode.scanning") : t("shopMode.scan")}
                </Text>
              </Pressable>
              <Text className="text-[10.5px] leading-relaxed text-muted-foreground">
                {t("shopMode.photoNote")}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  // El botón "guardar gasto" no puede fiarse solo del onBlur del
                  // campo: si se pulsa con el teclado abierto, RN cierra la
                  // pantalla antes de que el blur guarde. Confirmamos aquí.
                  commitActual();
                  onClose();
                }}
                className="items-center rounded-2xl bg-success py-4 active:opacity-90"
              >
                <Text className="text-sm font-sans-bold text-success-foreground">
                  {t("shopMode.complete")}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              className="items-center rounded-2xl bg-foreground py-4 active:opacity-90"
            >
              <Text className="text-sm font-sans-bold text-background">{t("shopMode.finish")}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
