import { isCleanFood } from "../lib/content-guard";
import { X } from "lucide-react-native";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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

/**
 * Atajos: su identificador y cuántas unidades son N toques (dos galletas por
 * toque). La etiqueta del chip y la frase que rellena están en el catálogo
 * (`snack.presets.<id>`), en el idioma de la persona.
 */
const PRESETS: { id: string; qty: (n: number) => number }[] = [
  { id: "nuts", qty: (n) => n },
  { id: "biscuits", qty: (n) => n * 2 },
  { id: "chocolate", qty: (n) => n * 2 },
  { id: "crisps", qty: (n) => n },
  { id: "beer", qty: (n) => n },
  { id: "wine", qty: (n) => n },
  { id: "fruit", qty: (n) => n },
  { id: "cheese", qty: (n) => n },
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
  const { t } = useTranslation();
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
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("common.removeNamed", { what: label })}
          className="py-1.5 pr-2.5 active:opacity-70"
        >
          <X size={12} color="#3e3d39" />
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
const joinNaturally = (parts: string[], t: TFunction): string => {
  if (parts.length <= 1) return parts.join("");
  return t("common.listAnd", {
    rest: parts.slice(0, -1).join(", "),
    last: parts[parts.length - 1],
  });
};

/** Reconstruye el texto libre a partir de los presets activos (varios a la vez). */
const buildPresetText = (counts: Record<number, number>, t: TFunction): string => {
  const parts = PRESETS.map((preset, idx) => {
    const count = counts[idx] ?? 0;
    return count > 0
      ? t(`snack.presets.${preset.id}.text`, { count, qty: preset.qty(count) })
      : null;
  }).filter((p): p is string => p !== null);
  return joinNaturally(
    parts.map((part, i) => (i === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1))),
    t,
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
  const { t } = useTranslation();
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
    setText(buildPresetText(next, t));
    setEstimate(null);
    setKcalInput(null);
    setError(null);
  };

  const removePreset = (idx: number) => {
    const next = { ...presetCounts };
    delete next[idx];
    setPresetCounts(next);
    setText(buildPresetText(next, t));
    setEstimate(null);
    setKcalInput(null);
    setError(null);
  };

  const calculate = async () => {
    if (text.trim().length < SNACK_TEXT_MIN) {
      setError(t("snack.tellMe"));
      return;
    }
    if (!isCleanFood(text.trim())) {
      setError(t("food.blocked"));
      return;
    }
    setBusy("estimate");
    setError(null);
    try {
      const res = await apiPost<SnackEstimate>("snacks/estimate", { text: text.trim() });
      // No es comida: aquí NO se ofrece ponerlo a mano (ese respaldo era la
      // forma de colar una broma saltándose el cálculo).
      if (res.notFood) {
        setError(t("food.blocked"));
        return;
      }
      setEstimate(res);
      // Sin cifra fiable se pide a mano en vez de inventarla.
      setKcalInput(res.resolved ? null : "");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("snack.estimateFailed"));
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
      setError(e instanceof Error ? e.message : t("snack.saveFailed"));
      setBusy(null);
    }
  };

  const ingredientsLine = estimate?.ingredients.map((i) => `${i.name} ${i.grams} g`).join(" · ");

  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-2">
        {PRESETS.map((p, i) => (
          <Chip
            key={p.id}
            label={t(`snack.presets.${p.id}.label`)}
            active={(presetCounts[i] ?? 0) > 0}
            count={presetCounts[i] ?? 0}
            onPress={() => clickPreset(i)}
            onRemove={() => removePreset(i)}
          />
        ))}
      </View>

      <View className="relative">
        <TextInput
          placeholder={t("snack.placeholder")}
          placeholderTextColor="#a8a096"
          value={text}
          onChangeText={changeText}
          multiline
          editable={busy == null}
          className="min-h-[64px] rounded-2xl bg-secondary px-3.5 py-3 pr-11 text-sm text-foreground"
        />
        <DictateButton
          onText={(said) => changeText(text ? `${text.trim()} ${said}` : said)}
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
          {busy === "estimate" ? <ActivityIndicator size="small" color="#6b6256" /> : null}
          <Text className="text-sm font-semibold text-foreground">
            {busy === "estimate" ? t("snack.calculating") : t("snack.calculate")}
          </Text>
        </Pressable>
      ) : (
        <View className="gap-2 rounded-2xl bg-surface px-4 py-3.5">
          {!showNumbers ? (
            <Text className="text-sm text-foreground">
              {estimate.resolved ? t("snack.ready") : t("snack.describeBetter")}
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
                  <Text className="text-xs font-medium text-primary-ink">{t("common.change")}</Text>
                </Pressable>
              </View>
              <Text className="font-mono text-[11px] text-muted-foreground">
                {t("snack.macrosLine", {
                  protein: estimate.macros.protein_g,
                  carbs: estimate.macros.carbs_g,
                  fat: estimate.macros.fat_g,
                })}
              </Text>
            </>
          ) : (
            <View className="gap-1.5">
              <Text className="text-sm text-foreground">
                {estimate.resolved ? t("snack.howManyKcal") : t("snack.howManyKcalUnresolved")}
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
                      {t("snack.useEstimate", { kcal: estimatedKcal })}
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
            <Text className="text-[11px] leading-snug text-primary-ink">
              {t("snack.lowConfidence")}
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
            {busy === "save" ? t("common.saving") : t("snack.save")}
          </Text>
        </Pressable>
      ) : null}

      <Text className="text-center text-xs text-muted-foreground">
        {pastDay ? t("snack.footPast") : t("snack.footToday")}
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
  const { t } = useTranslation();
  const { pastDay = false, showNumbers = true } = form;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("hoy.addSnack")}
      description={
        pastDay ? t("snack.descPast") : showNumbers ? t("snack.descNumbers") : t("snack.descPlain")
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
