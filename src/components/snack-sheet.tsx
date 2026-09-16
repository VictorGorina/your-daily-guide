import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
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
import { scaleSnackMacros, SNACK_KCAL_MAX, SNACK_TEXT_MIN, type DaySnacks } from "@/lib/snacks";
import { estimateSnack, logSnack, type SnackEstimate } from "@/lib/snacks.functions";

/** Atajos: la etiqueta corta del chip y la frase que rellena, con cantidad. */
const PRESETS: { label: string; text: string }[] = [
  { label: "Frutos secos", text: "Un puñado de frutos secos" },
  { label: "Galletas", text: "Dos galletas" },
  { label: "Chocolate", text: "Dos onzas de chocolate" },
  { label: "Patatas de bolsa", text: "Una bolsa pequeña de patatas fritas" },
  { label: "Cerveza", text: "Una caña de cerveza" },
  { label: "Vino", text: "Una copa de vino" },
  { label: "Fruta", text: "Una pieza de fruta" },
  { label: "Queso", text: "Unos taquitos de queso" },
];

const chipClass = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-xs transition-colors ${
    active ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
  }`;

const parseKcal = (raw: string): number | null => {
  const n = Number(raw.replace(",", ".").trim());
  return raw.trim() && Number.isFinite(n) && n >= 0 && n <= SNACK_KCAL_MAX ? Math.round(n) : null;
};

/**
 * "Añadir picoteo" en Hoy (feature `picoteo-hoy`). Se describe lo que se picó,
 * se calcula con la tabla de composición y se enseña la cifra ANTES de
 * guardar; la persona puede corregirla (p. ej. con lo que pone el envase).
 * Copia en `mobile/components/snack-sheet.tsx`.
 */
export function SnackSheet({
  open,
  onOpenChange,
  today,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  today: string;
  onSaved: (snacks: DaySnacks) => void;
}) {
  const estimateFn = useServerFn(estimateSnack);
  const logFn = useServerFn(logSnack);
  const [text, setText] = useState("");
  const [estimate, setEstimate] = useState<SnackEstimate | null>(null);
  /** Cifra escrita a mano, o null si se usa la calculada. */
  const [kcalInput, setKcalInput] = useState<string | null>(null);
  const [busy, setBusy] = useState<"estimate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setText("");
    setEstimate(null);
    setKcalInput(null);
    setBusy(null);
    setError(null);
  };

  const changeText = (next: string) => {
    setText(next);
    // La cifra era de otro texto: hay que volver a calcular.
    setEstimate(null);
    setKcalInput(null);
    setError(null);
  };

  const calculate = async () => {
    if (text.trim().length < SNACK_TEXT_MIN) {
      setError("Cuéntame qué has picado.");
      return;
    }
    setBusy("estimate");
    setError(null);
    try {
      const res = await estimateFn({ data: { text: text.trim() } });
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
      onSaved(res.snacks);
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No he podido guardar el picoteo.");
      setBusy(null);
    }
  };

  const ingredientsLine = estimate?.ingredients.map((i) => `${i.name} ${i.grams} g`).join(" · ");

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle className="font-title font-semibold tracking-[-0.02em]">
            Añadir picoteo
          </SheetTitle>
          <SheetDescription>
            Apunta lo que has picado entre horas. Calculo sus kcal y, si hace falta, ajusto los
            próximos días.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-8">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => changeText(p.text)}
                className={chipClass(text === p.text)}
              >
                {p.label}
              </button>
            ))}
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
              {estimate.resolved && kcalInput == null && estimate.macros ? (
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
              {estimate.lowConfidence && kcalInput == null ? (
                <p className="text-[11px] leading-snug text-primary">
                  No he reconocido todo lo que has escrito: revisa la cifra.
                </p>
              ) : null}
            </div>
          )}

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          {estimate ? (
            <Button
              onClick={() => void save()}
              disabled={busy != null || !macros}
              className="w-full"
            >
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
            Hoy y la lista de la compra no cambian: si hace falta, ajusto los próximos días.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
