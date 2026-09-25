import { BLOCKED_FOOD_MESSAGE, isCleanFood } from "../lib/content-guard";
import { X } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { apiPost } from "../lib/api";
import type { MacroEstimate } from "../lib/daily";
import {
  scaleSnackMacros,
  SNACK_KCAL_MAX,
  SNACK_TEXT_MIN,
  type DaySnacks,
  type SnackEntry,
} from "../lib/snacks";
import { DictateButton } from "./dictate-button";
import { Sheet } from "./ui/sheet";

/** Respuesta de `POST /api/v1/snacks/estimate` (ver `estimateSnack` en la web). */
type SnackEstimate = {
  resolved: boolean;
  /** Lo descrito no es comida: se rechaza, no se ofrece ponerlo a mano. */
  notFood: boolean;
  macros: MacroEstimate | null;
  lowConfidence: boolean;
  ingredients: { name: string; grams: number }[];
};

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

function Chip({
  active,
  label,
  count,
  onPress,
  onRemove,
}: {
  active: boolean;
  label: string;
  count: number;
  onPress: () => void;
  onRemove: () => void;
}) {
  return (
    <View
      className={`flex-row items-center rounded-full ${active ? "bg-primary" : "bg-secondary"}`}
    >
      <Pressable onPress={onPress} className="px-3 py-1.5 active:opacity-80">
        <Text className={`text-xs ${active ? "text-primary-foreground" : "text-muted-foreground"}`}>
          {label}
          {active && count > 1 ? ` ×${count}` : ""}
        </Text>
      </Pressable>
      {active ? (
        <Pressable onPress={onRemove} hitSlop={8} className="py-1.5 pr-2.5 active:opacity-70">
          <X size={12} color="#fbfaf7" />
        </Pressable>
      ) : null}
    </View>
  );
}

const parseKcal = (raw: string): number | null => {
  const n = Number(raw.replace(",", ".").trim());
  return raw.trim() && Number.isFinite(n) && n >= 0 && n <= SNACK_KCAL_MAX ? Math.round(n) : null;
};

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

type SnackFormProps = {
  today: string;
  /** Ya está guardado (`/api/v1/snacks/log`). Quien lo usa programa el asentamiento del día. */
  onSaved: (snacks: DaySnacks, entry: SnackEntry) => void;
  /** Se abre desde el detalle de un día pasado (Plan y Hoy): solo corrige el
   * historial de ese día, no dispara el reajuste del plan. Cambia el copy. */
  pastDay?: boolean;
  /**
   * `false` con la preferencia de no ver cifras (ticket 01): se calcula igual,
   * pero no se enseña ninguna cifra ni se piden kcal a mano.
   */
  showNumbers?: boolean;
};

/**
 * El formulario de picoteo, sin la hoja: lo usan "Añadir picoteo" en Hoy
 * (`SnackSheet`) y la pestaña "Picoteo o extra" del registro guiado del chat
 * (`guided-log-sheet.tsx`), para que lo que se come fuera del plan se apunte
 * igual venga de donde venga. Su estado vive aquí y se pierde al desmontarse:
 * el `Modal` de la hoja no pinta su contenido cerrado, así que cada apertura
 * empieza de cero. Copia nativa de `src/components/snack-sheet.tsx`.
 */
export function SnackForm({ today, onSaved, pastDay = false, showNumbers = true }: SnackFormProps) {
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
    // El texto ya no coincide con los presets: un próximo toque empieza de cero.
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
      const res = await apiPost<SnackEstimate>("snacks/estimate", { text: text.trim() });
      // No es comida: aquí NO se ofrece ponerlo a mano (ese respaldo era la
      // forma de colar una broma saltándose el cálculo).
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
      const res = await apiPost<{ snacks: DaySnacks; entry: SnackEntry }>("snacks/log", {
        today,
        text: text.trim(),
        macros,
        source,
      });
      reset();
      onSaved(res.snacks, res.entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No he podido guardar el picoteo.");
      setBusy(null);
    }
  };

  const ingredientsLine = estimate?.ingredients.map((i) => `${i.name} ${i.grams} g`).join(" · ");

  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-2">
        {PRESETS.map((p, i) => (
          <Chip
            key={p.label}
            label={p.label}
            active={(presetCounts[i] ?? 0) > 0}
            count={presetCounts[i] ?? 0}
            onPress={() => clickPreset(i)}
            onRemove={() => removePreset(i)}
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
          {!showNumbers ? (
            <Text className="text-sm text-foreground">
              {estimate.resolved
                ? "Listo, ya lo tengo calculado."
                : "No he podido calcularlo. Descríbelo con algo más de detalle (qué era y cuánto, más o menos)."}
            </Text>
          ) : estimate.resolved && kcalInput == null && estimate.macros ? (
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
          {showNumbers && estimate.lowConfidence && kcalInput == null ? (
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
        {pastDay
          ? "Es solo para tu historial: no cambia el plan ni la compra."
          : "Hoy y la lista de la compra no cambian: si hace falta, ajusto los próximos días."}
      </Text>
    </View>
  );
}

/**
 * "Añadir picoteo" en Hoy (feature `picoteo-hoy`). Se describe lo que se picó,
 * se calcula con la tabla de composición y se enseña la cifra ANTES de
 * guardar; la persona puede corregirla (p. ej. con lo que pone el envase).
 * Copia nativa de `src/components/snack-sheet.tsx`.
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
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Añadir picoteo"
      description={
        pastDay
          ? "Apunta lo que picaste ese día para completar tu historial."
          : showNumbers
            ? "Apunta lo que has picado entre horas. Calculo sus kcal y, si hace falta, ajusto los próximos días."
            : "Apunta lo que has picado entre horas. Si hace falta, ajusto los próximos días."
      }
    >
      <View className="px-4 pb-8 pt-2">
        <SnackForm
          {...form}
          onSaved={(snacks) => {
            onSaved(snacks);
            onOpenChange(false);
          }}
        />
      </View>
    </Sheet>
  );
}
