import { useServerFn } from "@tanstack/react-start";
import { Loader2, X } from "lucide-react";
import { useState } from "react";

import { DictateButton } from "@/components/dictate-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { MacroEstimate } from "@/lib/guide.functions";
import {
  scaleSnackMacros,
  SNACK_KCAL_MAX,
  SNACK_TEXT_MIN,
  type DaySnacks,
  type SnackEntry,
} from "@/lib/snacks";
import { BLOCKED_FOOD_MESSAGE, isCleanFood } from "@/lib/content-guard";
import { estimateSnack, logSnack, type SnackEstimate } from "@/lib/snacks.functions";

/** Atajos: la etiqueta corta del chip y la frase que rellena, con cantidad. */
const PRESETS: { label: string; text: (n: number) => string }[] = [
  {
    label: "Frutos secos",
    text: (n) => (n === 1 ? "Un puñado de frutos secos" : `${n} puñados de frutos secos`),
  },
  { label: "Galletas", text: (n) => (n === 1 ? "Dos galletas" : `${n * 2} galletas`) },
  {
    label: "Chocolate",
    text: (n) => (n === 1 ? "Dos onzas de chocolate" : `${n * 2} onzas de chocolate`),
  },
  {
    label: "Patatas de bolsa",
    text: (n) =>
      n === 1 ? "Una bolsa pequeña de patatas fritas" : `${n} bolsas pequeñas de patatas fritas`,
  },
  { label: "Cerveza", text: (n) => (n === 1 ? "Una caña de cerveza" : `${n} cañas de cerveza`) },
  { label: "Vino", text: (n) => (n === 1 ? "Una copa de vino" : `${n} copas de vino`) },
  { label: "Fruta", text: (n) => (n === 1 ? "Una pieza de fruta" : `${n} piezas de fruta`) },
  {
    label: "Queso",
    text: (n) => (n === 1 ? "Unos taquitos de queso" : `${n} raciones de taquitos de queso`),
  },
];

const pillGroupClass = (active: boolean) =>
  `flex items-center gap-0.5 rounded-full text-xs transition-colors ${
    active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
  }`;

/** Junta frases en una lista natural: "A", "A y B", "A, B y C". */
const joinNaturally = (parts: string[]): string => {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
};

/** Reconstruye el texto libre a partir de los presets activos (varios a la vez). */
const buildPresetText = (counts: Record<number, number>): string => {
  const parts = PRESETS.map((preset, idx) => {
    const count = counts[idx] ?? 0;
    return count > 0 ? preset.text(count) : null;
  }).filter((p): p is string => p !== null);
  return joinNaturally(
    parts.map((part, i) => (i === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1))),
  );
};

const parseKcal = (raw: string): number | null => {
  const n = Number(raw.replace(",", ".").trim());
  return raw.trim() && Number.isFinite(n) && n >= 0 && n <= SNACK_KCAL_MAX ? Math.round(n) : null;
};

type SnackFormProps = {
  today: string;
  /** Ya está guardado (`logSnack`). Quien lo usa programa el asentamiento del día. */
  onSaved: (snacks: DaySnacks, entry: SnackEntry) => void;
  /** Se abre desde el detalle de un día pasado (Plan y Hoy): solo corrige el
   * historial de ese día, no dispara el reajuste del plan. Cambia el copy. */
  pastDay?: boolean;
  /**
   * `false` con la preferencia de no ver cifras (ticket 01): se calcula igual,
   * pero no se enseña ninguna cifra ni se piden kcal a mano. Si no se puede
   * calcular, se pide describirlo mejor.
   */
  showNumbers?: boolean;
};

/**
 * El formulario de picoteo, sin la hoja: lo usan "Añadir picoteo" en Hoy
 * (`SnackSheet`) y la pestaña "Picoteo o extra" del registro guiado del chat
 * (`guided-log-sheet.tsx`), para que lo que se come fuera del plan se apunte
 * igual venga de donde venga. Su estado vive aquí y se pierde al desmontarse:
 * las hojas desmontan su contenido al cerrarse, así que cada apertura empieza
 * de cero. Copia en `mobile/components/snack-sheet.tsx`.
 */
export function SnackForm({ today, onSaved, pastDay = false, showNumbers = true }: SnackFormProps) {
  const estimateFn = useServerFn(estimateSnack);
  const logFn = useServerFn(logSnack);
  const [text, setText] = useState("");
  const [estimate, setEstimate] = useState<SnackEstimate | null>(null);
  /** Cifra escrita a mano, o null si se usa la calculada. */
  const [kcalInput, setKcalInput] = useState<string | null>(null);
  const [busy, setBusy] = useState<"estimate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Presets activos ahora mismo: idx del preset -> nº de veces pulsado. */
  const [presetCounts, setPresetCounts] = useState<Record<number, number>>({});

  const reset = () => {
    setText("");
    setEstimate(null);
    setKcalInput(null);
    setBusy(null);
    setError(null);
    setPresetCounts({});
  };

  const changeText = (next: string) => {
    setText(next);
    // La cifra era de otro texto: hay que volver a calcular.
    setEstimate(null);
    setKcalInput(null);
    setError(null);
    // El texto ya no coincide con los presets: un próximo clic empieza de cero.
    setPresetCounts({});
  };

  const clickPreset = (idx: number) => {
    const next = { ...presetCounts, [idx]: (presetCounts[idx] ?? 0) + 1 };
    setPresetCounts(next);
    setText(buildPresetText(next));
    setEstimate(null);
    setKcalInput(null);
    setError(null);
  };

  const removePreset = (idx: number) => {
    const next = { ...presetCounts };
    delete next[idx];
    setPresetCounts(next);
    setText(buildPresetText(next));
    setEstimate(null);
    setKcalInput(null);
    setError(null);
  };

  const calculate = async () => {
    if (text.trim().length < SNACK_TEXT_MIN) {
      setError("Cuéntame qué has picado.");
      return;
    }
    if (!isCleanFood(text.trim())) {
      setError(BLOCKED_FOOD_MESSAGE);
      return;
    }
    setBusy("estimate");
    setError(null);
    try {
      const res = await estimateFn({ data: { text: text.trim() } });
      // Que no sea comida no es "no he podido calcularlo": ahí NO se ofrece
      // ponerlo a mano, porque ese respaldo era la forma de colar una broma
      // saltándose el cálculo.
      if (res.notFood) {
        setError(BLOCKED_FOOD_MESSAGE);
        return;
      }
      setEstimate(res);
      // Sin cifra fiable se pide a mano en vez de inventarla.
      setKcalInput(res.resolved ? null : "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No he podido calcularlo ahora mismo.");
    } finally {
      setBusy(null);
    }
  };

  const manualKcal = kcalInput == null ? null : parseKcal(kcalInput);
  const estimatedKcal = estimate?.resolved ? (estimate.macros?.kcal ?? null) : null;
  const macros: MacroEstimate | null =
    kcalInput != null
      ? manualKcal == null
        ? null
        : scaleSnackMacros(estimate?.macros ?? null, manualKcal)
      : estimate?.resolved
        ? estimate.macros
        : null;
  const source = kcalInput != null && manualKcal !== estimatedKcal ? "manual" : "lookup";

  const save = async () => {
    if (!macros) return;
    setBusy("save");
    setError(null);
    try {
      const res = await logFn({ data: { today, text: text.trim(), macros, source } });
      reset();
      onSaved(res.snacks, res.entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No he podido guardar el picoteo.");
      setBusy(null);
    }
  };

  const ingredientsLine = estimate?.ingredients.map((i) => `${i.name} ${i.grams} g`).join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p, i) => {
          const count = presetCounts[i] ?? 0;
          const active = count > 0;
          return (
            <div key={p.label} className={pillGroupClass(active)}>
              <button type="button" onClick={() => clickPreset(i)} className="px-3 py-1.5">
                {p.label}
                {active && count > 1 ? ` ×${count}` : ""}
              </button>
              {active ? (
                <button
                  type="button"
                  onClick={() => removePreset(i)}
                  aria-label={`Quitar ${p.label}`}
                  className="py-1.5 pr-2.5 opacity-80"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <Textarea
          placeholder="Ej: un puñado de almendras"
          value={text}
          onChange={(e) => changeText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !estimate) {
              e.preventDefault();
              void calculate();
            }
          }}
          rows={2}
          className="text-sm"
          disabled={busy != null}
        />
        {/* Debajo y no encima del campo: en web el botón lleva texto
          ("Dictar") y tapaba lo escrito. */}
        <DictateButton
          onText={(t) => changeText(text ? `${text.trim()} ${t}` : t)}
          label="Dictar"
        />
      </div>

      {!estimate ? (
        <Button
          variant="secondary"
          onClick={() => void calculate()}
          disabled={busy != null || !text.trim()}
          className="w-full"
        >
          {busy === "estimate" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Calculando…
            </>
          ) : (
            "Calcular"
          )}
        </Button>
      ) : (
        <div className="space-y-2 rounded-2xl bg-surface px-4 py-3.5">
          {!showNumbers ? (
            <p className="text-sm text-foreground">
              {estimate.resolved
                ? "Listo, ya lo tengo calculado."
                : "No he podido calcularlo. Descríbelo con algo más de detalle (qué era y cuánto, más o menos)."}
            </p>
          ) : estimate.resolved && kcalInput == null && estimate.macros ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-title text-2xl leading-7 text-foreground">
                  ≈ {estimate.macros.kcal} kcal
                </p>
                <button
                  type="button"
                  onClick={() => setKcalInput(String(estimate.macros?.kcal ?? ""))}
                  className="text-xs font-medium text-primary"
                >
                  Cambiar
                </button>
              </div>
              <p className="font-num text-[11px] text-muted-foreground">
                {estimate.macros.protein_g} g prot · {estimate.macros.carbs_g} g hidratos ·{" "}
                {estimate.macros.fat_g} g grasa
              </p>
            </>
          ) : (
            <div className="space-y-1.5">
              <label htmlFor="snack-kcal" className="block text-sm text-foreground">
                {estimate.resolved
                  ? "¿Cuántas kcal son?"
                  : "No he podido calcularlo. ¿Cuántas kcal son? (lo pone el envase)"}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="snack-kcal"
                  inputMode="numeric"
                  value={kcalInput ?? ""}
                  onChange={(e) => setKcalInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && macros) void save();
                  }}
                  placeholder="kcal"
                  autoFocus
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">kcal</span>
                {estimate.resolved ? (
                  <button
                    type="button"
                    onClick={() => setKcalInput(null)}
                    className="ml-auto text-xs font-medium text-muted-foreground"
                  >
                    Usar ≈ {estimatedKcal}
                  </button>
                ) : null}
              </div>
            </div>
          )}
          {ingredientsLine ? (
            <p className="text-[11px] leading-snug text-muted-foreground">{ingredientsLine}</p>
          ) : null}
          {showNumbers && estimate.lowConfidence && kcalInput == null ? (
            <p className="text-[11px] leading-snug text-primary">
              No he reconocido todo lo que has escrito: revisa la cifra.
            </p>
          ) : null}
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {estimate ? (
        <Button onClick={() => void save()} disabled={busy != null || !macros} className="w-full">
          {busy === "save" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Guardando…
            </>
          ) : (
            "Guardar picoteo"
          )}
        </Button>
      ) : null}

      <p className="text-center text-xs text-muted-foreground">
        {pastDay
          ? "Es solo para tu historial: no cambia el plan ni la compra."
          : "Hoy y la lista de la compra no cambian: si hace falta, ajusto los próximos días."}
      </p>
    </div>
  );
}

/**
 * "Añadir picoteo" en Hoy (feature `picoteo-hoy`). Se describe lo que se picó,
 * se calcula con la tabla de composición y se enseña la cifra ANTES de
 * guardar; la persona puede corregirla (p. ej. con lo que pone el envase).
 * Copia en `mobile/components/snack-sheet.tsx`.
 */
export function SnackSheet({
  open,
  onOpenChange,
  onSaved,
  ...form
}: Omit<SnackFormProps, "onSaved"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (snacks: DaySnacks) => void;
}) {
  const { pastDay = false, showNumbers = true } = form;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-title font-semibold tracking-[-0.02em]">
            Añadir picoteo
          </SheetTitle>
          <SheetDescription>
            {pastDay
              ? "Apunta lo que picaste ese día para completar tu historial."
              : showNumbers
                ? "Apunta lo que has picado entre horas. Calculo sus kcal y, si hace falta, ajusto los próximos días."
                : "Apunta lo que has picado entre horas. Si hace falta, ajusto los próximos días."}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-8">
          <SnackForm
            {...form}
            onSaved={(snacks) => {
              onSaved(snacks);
              onOpenChange(false);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
