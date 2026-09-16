import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { apiPost } from "../lib/api";
import type { MacroEstimate } from "../lib/daily";
import { scaleSnackMacros, SNACK_KCAL_MAX, SNACK_TEXT_MIN, type DaySnacks } from "../lib/snacks";
import { DictateButton } from "./dictate-button";
import { Sheet } from "./ui/sheet";

/** Respuesta de `POST /api/v1/snacks/estimate` (ver `estimateSnack` en la web). */
type SnackEstimate = {
  resolved: boolean;
  macros: MacroEstimate | null;
  lowConfidence: boolean;
  ingredients: { name: string; grams: number }[];
};

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

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full px-3 py-1.5 active:opacity-80 ${
        active ? "bg-primary" : "bg-secondary"
      }`}
    >
      <Text className={`text-xs ${active ? "text-primary-foreground" : "text-muted-foreground"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

const parseKcal = (raw: string): number | null => {
  const n = Number(raw.replace(",", ".").trim());
  return raw.trim() && Number.isFinite(n) && n >= 0 && n <= SNACK_KCAL_MAX ? Math.round(n) : null;
};

/**
 * "Añadir picoteo" en Hoy (feature `picoteo-hoy`). Se describe lo que se picó,
 * se calcula con la tabla de composición y se enseña la cifra ANTES de
 * guardar; la persona puede corregirla (p. ej. con lo que pone el envase).
 * Copia nativa de `src/components/snack-sheet.tsx`.
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
      const res = await apiPost<SnackEstimate>("snacks/estimate", { text: text.trim() });
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
      const res = await apiPost<{ snacks: DaySnacks }>("snacks/log", {
        today,
        text: text.trim(),
        macros,
        source,
      });
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
      title="Añadir picoteo"
      description="Apunta lo que has picado entre horas. Calculo sus kcal y, si hace falta, ajusto los próximos días."
    >
      <View className="gap-4 px-4 pb-8 pt-2">
        <View className="flex-row flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Chip
              key={p.label}
              label={p.label}
              active={text === p.text}
              onPress={() => changeText(p.text)}
            />
          ))}
        </View>

        <View className="relative">
          <TextInput
            placeholder="Ej: un puñado de almendras"
            placeholderTextColor="#a8a096"
            value={text}
            onChangeText={changeText}
            multiline
            editable={busy == null}
            className="min-h-[64px] rounded-2xl bg-secondary px-3.5 py-3 pr-11 text-sm text-foreground"
          />
          <DictateButton
            onText={(t) => changeText(text ? `${text.trim()} ${t}` : t)}
            className="absolute right-2 top-2"
          />
        </View>

        {!estimate ? (
          <Pressable
            onPress={calculate}
            disabled={busy != null || !text.trim()}
            className={`h-12 flex-row items-center justify-center gap-2 rounded-full bg-secondary active:opacity-80 ${
              busy != null || !text.trim() ? "opacity-60" : ""
            }`}
          >
            {busy === "estimate" ? <ActivityIndicator size="small" color="#83796c" /> : null}
            <Text className="text-sm font-semibold text-foreground">
              {busy === "estimate" ? "Calculando…" : "Calcular"}
            </Text>
          </Pressable>
        ) : (
          <View className="gap-2 rounded-2xl bg-surface px-4 py-3.5">
            {estimate.resolved && kcalInput == null && estimate.macros ? (
              <>
                <View className="flex-row items-baseline justify-between gap-3">
                  <Text
                    className="font-heading text-foreground"
                    style={{ fontSize: 24, lineHeight: 28 }}
                  >
                    ≈ {estimate.macros.kcal} kcal
                  </Text>
                  <Pressable
                    onPress={() => setKcalInput(String(estimate.macros?.kcal ?? ""))}
                    hitSlop={8}
                    className="active:opacity-70"
                  >
                    <Text className="text-xs font-medium text-primary">Cambiar</Text>
                  </Pressable>
                </View>
                <Text className="font-mono text-[11px] text-muted-foreground">
                  {estimate.macros.protein_g} g prot · {estimate.macros.carbs_g} g hidratos ·{" "}
                  {estimate.macros.fat_g} g grasa
                </Text>
              </>
            ) : (
              <View className="gap-1.5">
                <Text className="text-sm text-foreground">
                  {estimate.resolved
                    ? "¿Cuántas kcal son?"
                    : "No he podido calcularlo. ¿Cuántas kcal son? (lo pone el envase)"}
                </Text>
                <View className="flex-row items-center gap-2">
                  <TextInput
                    value={kcalInput ?? ""}
                    onChangeText={setKcalInput}
                    keyboardType="number-pad"
                    placeholder="kcal"
                    placeholderTextColor="#a8a096"
                    autoFocus
                    className="h-11 w-28 rounded-xl bg-secondary px-3 text-base text-foreground"
                  />
                  <Text className="text-sm text-muted-foreground">kcal</Text>
                  {estimate.resolved ? (
                    <Pressable
                      onPress={() => setKcalInput(null)}
                      hitSlop={8}
                      className="ml-auto active:opacity-70"
                    >
                      <Text className="text-xs font-medium text-muted-foreground">
                        Usar ≈ {estimatedKcal}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            )}
            {ingredientsLine ? (
              <Text className="text-[11px] leading-snug text-muted-foreground">
                {ingredientsLine}
              </Text>
            ) : null}
            {estimate.lowConfidence && kcalInput == null ? (
              <Text className="text-[11px] leading-snug text-primary">
                No he reconocido todo lo que has escrito: revisa la cifra.
              </Text>
            ) : null}
          </View>
        )}

        {error ? <Text className="text-xs text-destructive">{error}</Text> : null}

        {estimate ? (
          <Pressable
            onPress={save}
            disabled={busy != null || !macros}
            className={`h-12 flex-row items-center justify-center gap-2 rounded-full bg-primary active:opacity-90 ${
              busy != null || !macros ? "opacity-60" : ""
            }`}
          >
            {busy === "save" ? <ActivityIndicator size="small" color="#fff" /> : null}
            <Text className="text-sm font-semibold text-primary-foreground">
              {busy === "save" ? "Guardando…" : "Guardar picoteo"}
            </Text>
          </Pressable>
        ) : null}

        <Text className="text-center text-xs text-muted-foreground">
          Hoy y la lista de la compra no cambian: si hace falta, ajusto los próximos días.
        </Text>
      </View>
    </Sheet>
  );
}
