import { AlertCircle, ArrowRight, Check, Info, Pencil } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
  type FlatNode,
  GAP_TYPE,
  gapHelpKey,
  gapLabelKey,
  type GapKey,
  KEY_FIELDS,
  SCREENS,
  screenTitleKey,
} from "../../lib/onboarding-script";
import { C, OverlayHeader, Shell } from "./shell";

type Props = {
  flat: FlatNode[];
  answers: Record<string, string>;
  skipped: Record<string, true>;
  answeredCount: number;
  total: number;
  /** Todas las obligatorias respondidas: se enseñan los datos clave y se puede confirmar. */
  canConfirm: boolean;
  requiredPendingCount: number;
  gapMissing: GapKey[];
  gapValues: Record<string, string>;
  onGapChange: (key: GapKey, text: string) => void;
  qText: (node: FlatNode) => string;
  error: string | null;
  saving: boolean;
  onClose: () => void;
  onGoTo: (key: string) => void;
  onConfirm: () => void;
};

/** Resumen: datos clave, preguntas aparcadas y las respuestas por etapa. */
export function SummaryPanel({
  flat,
  answers,
  skipped,
  answeredCount,
  total,
  canConfirm,
  requiredPendingCount,
  gapMissing,
  gapValues,
  onGapChange,
  qText,
  error,
  saving,
  onClose,
  onGoTo,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const pending = flat.filter((n) => skipped[n.key]);
  const sections = SCREENS.map((s, si) => ({
    id: s.id,
    title: t(screenTitleKey(s)),
    items: flat.filter((n) => n.si === si && answers[n.key] !== undefined),
  })).filter((s) => s.items.length);
  const emptyResumen = pending.length === 0 && sections.length === 0;

  return (
    <Shell>
      <OverlayHeader
        eyebrow={t("onboarding.summary.eyebrow", { done: answeredCount, total })}
        title={t("onboarding.summary.title")}
        closeLabel={t("onboarding.chat.close")}
        onClose={onClose}
      />
      <Text className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
        {t("onboarding.summary.body")}
      </Text>

      <ScrollView className="mt-4 flex-1" contentContainerClassName="gap-5 pb-2">
        {canConfirm ? (
          <View className="gap-3 rounded-3xl bg-surface p-4">
            <Text className="text-sm font-sans-medium text-foreground">
              {t("onboarding.summary.keyData")}
            </Text>
            {KEY_FIELDS.map((key) => (
              <View key={key}>
                <View className="flex-row items-center gap-1.5">
                  <Text className="text-xs text-muted-foreground">{t(gapLabelKey(key))}</Text>
                  {gapMissing.includes(key) ? (
                    <View className="rounded-full bg-primary-soft px-2 py-0.5">
                      <Text className="text-[10px] font-sans-medium text-primary-ink">
                        {t("onboarding.summary.missing")}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <TextInput
                  value={gapValues[key] ?? ""}
                  onChangeText={(text) => onGapChange(key, text)}
                  keyboardType={GAP_TYPE[key] === "number" ? "decimal-pad" : "default"}
                  placeholder={GAP_TYPE[key] === "time" ? "HH:MM" : ""}
                  placeholderTextColor={C.muted}
                  className="mt-1 h-12 rounded-2xl bg-muted px-4 text-sm text-foreground"
                />
                <Text className="mt-1 text-[11px] text-muted-foreground">{t(gapHelpKey(key))}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {pending.length ? (
          <View className="gap-2.5 rounded-3xl bg-primary-soft p-4">
            <Text className="text-[13px] font-sans-semibold text-foreground">
              {t("onboarding.summary.pending", { count: pending.length })}
            </Text>
            {pending.map((n) => (
              <Pressable
                accessibilityRole="button"
                key={n.key}
                onPress={() => onGoTo(n.key)}
                className="flex-row items-center gap-3 rounded-2xl bg-surface p-3.5 active:opacity-90"
              >
                <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
                  {qText(n)}
                </Text>
                <Text className="text-xs font-sans-semibold text-primary-ink">
                  {t("onboarding.summary.answer")}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {sections.map((s) => (
          <View key={s.id} className="gap-2">
            <Text className="px-1 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
              {s.title}
            </Text>
            {s.items.map((n) => (
              <Pressable
                accessibilityRole="button"
                key={n.key}
                onPress={() => onGoTo(n.key)}
                className="rounded-3xl bg-surface p-4 active:opacity-90"
              >
                <Text className="text-xs leading-relaxed text-muted-foreground">{qText(n)}</Text>
                <View className="mt-1.5 flex-row items-start justify-between gap-3">
                  <Text className="flex-1 text-sm text-foreground">{answers[n.key]}</Text>
                  <Pencil size={14} color={C.muted} />
                </View>
              </Pressable>
            ))}
          </View>
        ))}

        {emptyResumen ? (
          <Text className="px-1 py-6 text-[13px] leading-relaxed text-muted-foreground">
            {t("onboarding.summary.empty")}
          </Text>
        ) : null}
      </ScrollView>

      {error ? (
        <View className="mb-2 flex-row items-start gap-1.5">
          <AlertCircle size={14} color={C.danger} />
          <Text className="flex-1 text-xs text-destructive">{error}</Text>
        </View>
      ) : null}
      {!canConfirm && requiredPendingCount ? (
        <View className="mb-2 flex-row items-start gap-1.5">
          <Info size={14} color={C.primary} />
          <Text className="flex-1 text-xs text-muted-foreground">
            {t("onboarding.summary.remaining", { count: requiredPendingCount })}
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={() => (canConfirm ? onConfirm() : onClose())}
        className="flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90 disabled:opacity-50"
      >
        <Text className="text-sm font-sans-semibold text-primary-foreground">
          {t(
            saving
              ? "onboarding.summary.saving"
              : canConfirm
                ? "onboarding.summary.confirm"
                : "onboarding.summary.backToChat",
          )}
        </Text>
        {saving ? null : canConfirm ? (
          <Check size={16} color={C.onPrimary} />
        ) : (
          <ArrowRight size={16} color={C.onPrimary} />
        )}
      </Pressable>
    </Shell>
  );
}
