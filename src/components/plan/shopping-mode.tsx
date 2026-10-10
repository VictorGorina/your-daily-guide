import { useCurrencySymbol, useMoney } from "@/lib/use-money";
import { Check, ChevronLeft, Receipt } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  daysInMonth,
  tripDayRange,
  type ShoppingCadence,
  type ShoppingItem,
} from "@/lib/plan-shared";
import { freshRisksForTrip, freshRiskText } from "@/lib/perishability";
import { CategoryIcon } from "./shopping-bits";

/**
 * Reescala una imagen a JPEG de como máximo `maxSide` px de lado y devuelve el
 * base64 sin la cabecera `data:`. Una foto de tiquet queda muy por debajo del
 * límite de tamaño del endpoint y del body de Vercel.
 */
async function imageFileToBase64(
  file: File,
  maxSide = 1280,
): Promise<{ base64: string; mime: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("No se pudo abrir la imagen"));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { base64: dataUrl.split(",")[1] ?? "", mime: file.type || "image/jpeg" };
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", 0.72);
  return { base64: out.split(",")[1] ?? "", mime: "image/jpeg" };
}

// ---------------------------------------------------------------------------
// Modo compra — pantalla completa solo con lo que falta
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
  trip: { trip: number; groups: { category: string; items: ShoppingItem[] }[] } | undefined;
  cadence: ShoppingCadence;
  coverage: { fromDay: number; toDay: number } | undefined;
  tripsTotal: number;
  selectedTrip: number;
  month: string;
  onToggle: (itemName: string) => void;
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
  const spendId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const pickReceipt = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { base64, mime } = await imageFileToBase64(file);
      if (base64) onScanReceipt(base64, mime);
    } catch {
      toast.error(t("plan.errors.photo"));
    }
  };

  // Solo los items que todavía faltan o que se acaban de marcar como "bought"
  // en esta sesión de compra (para que se vean tachados, no desaparezcan).
  const allItems = useMemo(
    () => (trip?.groups ?? []).flatMap((g) => g.items.filter((i) => i.owned !== "fridge")),
    [trip],
  );
  const shopGroups = useMemo(() => {
    if (!trip) return [];
    const cats = new Map<string, ShoppingItem[]>();
    for (const g of trip.groups) {
      for (const item of g.items) {
        // Excluir los que ya estaban "en casa" — el modo compra no los muestra.
        if (item.owned === "fridge") continue;
        const arr = cats.get(g.category) ?? [];
        arr.push(item);
        cats.set(g.category, arr);
      }
    }
    return [...cats.entries()].map(([cat, items]) => ({ category: cat, items }));
  }, [trip]);

  const leftItems = allItems.filter((i) => !i.owned);
  const leftTotal = leftItems.reduce((s, i) => s + i.price_eur, 0);
  const doneTotal = allItems
    .filter((i) => i.owned === "store")
    .reduce((s, i) => s + i.price_eur, 0);
  const pct = allItems.length ? ((allItems.length - leftItems.length) / allItems.length) * 100 : 0;
  const allDone = leftItems.length === 0;

  const covOrFull = coverage ?? { fromDay: 1, toDay: daysInMonth(month) };
  const tripRange = tripDayRange(covOrFull, tripsTotal, selectedTrip);
  const freshRisks = trip
    ? freshRisksForTrip(trip.groups, covOrFull, tripsTotal, selectedTrip)
    : [];
  const monthShort = t(`monthsShort.${Number(month.slice(5, 7)) - 1}`);

  // Último importe enviado, para que `commitActual` no repita la misma mutación
  // cuando lo disparan seguidos el onBlur del campo y el onClick del botón.
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
    // Modo compra: pantalla completa enfocada (diseño 1b). El overlay tapa la
    // barra de navegación y la burbuja del coach; se sale con la flecha ←.
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shopping-mode-title"
      className="fixed inset-0 z-[60] flex flex-col bg-background"
    >
      <div className="flex-1 overflow-y-auto px-5 pb-6 pt-12">
        <div className="mx-auto max-w-lg">
          {/* Cabecera modo compra */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              aria-label={t("shopMode.exit")}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface text-muted-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("shopMode.header", {
                  n: selectedTrip + 1,
                  total: tripsTotal,
                  from: tripRange.from,
                  to: tripRange.to,
                  month: monthShort,
                })}
              </p>
              <h1
                id="shopping-mode-title"
                className="font-title text-2xl font-semibold tracking-[-0.02em] leading-tight"
              >
                {t("shopMode.title")}
              </h1>
            </div>
          </div>

          {/* Resumen compra */}
          <div className="mt-4 surface-card p-5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-muted-foreground">{t("shopMode.left")}</p>
                <p className="mt-0.5 font-title text-[30px] font-semibold tabular-nums tracking-tight text-primary-ink">
                  {money(Math.round(leftTotal * 100) / 100)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-[11px] text-muted-foreground">
                  {t("shopMode.inCart")}
                </p>
                <p className="mt-0.5 font-mono text-[15px] font-medium text-success">
                  {money(Math.round(doneTotal * 100) / 100)}
                </p>
              </div>
            </div>
            <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-success transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              {t("shopMode.progress", { left: leftItems.length, total: allItems.length })}
            </p>
          </div>

          {freshRisks.length ? (
            <div className="mt-3.5 rounded-[18px] bg-warning/20 px-4 py-3">
              <p className="text-xs leading-relaxed text-foreground">
                {freshRiskText(freshRisks, tripRange.to - tripRange.from + 1, cadence, t, true)}
              </p>
            </div>
          ) : null}

          {/* Lista de ingredientes agrupados */}
          <div className="mt-3.5 flex flex-col gap-4">
            {shopGroups.map((g) => (
              <div key={g.category}>
                <div className="flex items-center gap-2 px-1 pb-2">
                  <CategoryIcon
                    category={g.category}
                    className="h-[15px] w-[15px] text-primary-ink"
                  />
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {g.category}
                  </h3>
                </div>
                <ul className="flex flex-col gap-1.5 p-0">
                  {g.items.map((item, i) => {
                    const done = item.owned === "store";
                    return (
                      <li
                        key={`${item.name}-${i}`}
                        role="checkbox"
                        aria-checked={done}
                        tabIndex={0}
                        // En modo compra, tocar (o Espacio/Intro) alterna "store" (comprado)
                        onClick={() => onToggle(item.name)}
                        onKeyDown={(e) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault(); // sin esto, Espacio hace scroll
                            onToggle(item.name);
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-3.5 rounded-[18px] px-4 py-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:scale-[0.99] ${
                          done ? "bg-secondary/45" : "bg-surface"
                        }`}
                      >
                        {/* Checkbox cuadrado redondeado */}
                        <span
                          className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] transition-colors ${
                            done
                              ? "bg-success text-success-foreground"
                              : "border-[1.5px] border-border text-transparent"
                          }`}
                        >
                          <Check className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-base font-semibold tracking-[-0.01em] ${done ? "text-muted-foreground line-through" : ""}`}
                          >
                            {item.name}
                          </span>
                          <span className="block font-mono text-[11px] text-muted-foreground">
                            {item.qty} · {money(item.price_eur)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Botón fijo al fondo (diseño 1b) */}
      <div className="border-t border-secondary bg-background px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-lg">
          {allDone ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-[20px] bg-surface px-4 py-3">
                <label htmlFor={spendId} className="flex-1 text-xs text-muted-foreground">
                  {t("shopMode.spendQuestion")}
                </label>
                <input
                  id={spendId}
                  type="text"
                  inputMode="decimal"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={commitActual}
                  placeholder={money(Math.round(doneTotal * 100) / 100)}
                  disabled={savingActual}
                  className="w-24 rounded-lg bg-secondary px-2 py-1.5 text-right text-sm tabular-nums disabled:opacity-60"
                />
                <span className="text-xs text-muted-foreground">{currencySign}</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  void pickReceipt(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={scanningReceipt}
                className="flex w-full items-center justify-center gap-2 rounded-[20px] border border-secondary py-3 text-xs font-semibold text-muted-foreground disabled:opacity-60"
              >
                <Receipt className="h-4 w-4" />
                {scanningReceipt ? t("shopMode.scanning") : t("shopMode.scan")}
              </button>
              <p className="text-[10.5px] leading-relaxed text-muted-foreground">
                {t("shopMode.photoNote")}
              </p>
              <button
                type="button"
                onClick={() => {
                  // "guardar gasto" tiene que guardar aunque el foco siga en el
                  // campo (Enter, o clic sin que dispare el onBlur antes).
                  commitActual();
                  onClose();
                }}
                className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-success py-[17px] text-sm font-bold text-success-foreground"
              >
                {t("shopMode.complete")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-foreground py-[17px] text-sm font-bold text-background"
            >
              {t("shopMode.finish")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
