import { ArrowRight, Check, ChevronRight } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";

import {
  type FlatNode,
  SCREENS,
  screenSubtitleKey,
  screenTitleKey,
} from "../../lib/onboarding-script";
import { C, OverlayHeader, Shell } from "./shell";

type Props = {
  flat: FlatNode[];
  answers: Record<string, string>;
  /** Índice de la etapa en la que está la persona. */
  currentStage: number;
  onClose: () => void;
  onGoTo: (key: string) => void;
  onSummary: () => void;
};

/** Índice de las etapas: cuánto lleva cada una y salto a su primera pregunta. */
export function StageIndex({ flat, answers, currentStage, onClose, onGoTo, onSummary }: Props) {
  const { t } = useTranslation();
  return (
    <Shell>
      <OverlayHeader
        eyebrow={t("onboarding.index.eyebrow")}
        title={t("onboarding.index.title")}
        closeLabel={t("onboarding.chat.close")}
        onClose={onClose}
      />
      <Text className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
        {t("onboarding.index.body")}
      </Text>
      <ScrollView className="mt-4 flex-1" contentContainerClassName="gap-2 pb-2">
        {SCREENS.map((s, si) => {
          const nodes = flat.filter((n) => n.si === si);
          const doneN = nodes.filter((n) => answers[n.key] !== undefined).length;
          const complete = doneN === nodes.length;
          const isCur = si === currentStage;
          const first = nodes[0];
          return (
            <Pressable
              accessibilityRole="button"
              key={s.id}
              onPress={() => first && onGoTo(first.key)}
              className="flex-row items-center gap-3.5 rounded-2xl bg-surface p-4 active:opacity-90"
            >
              <View
                className={`h-9 w-9 items-center justify-center rounded-full ${
                  complete ? "bg-success" : isCur ? "bg-primary" : "bg-secondary"
                }`}
              >
                {complete ? (
                  <Check size={16} color={C.onDark} />
                ) : (
                  <Text
                    className={`font-mono text-xs ${
                      isCur ? "text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {si + 1}
                  </Text>
                )}
              </View>
              <View className="flex-1">
                <Text className="text-[15px] font-sans-semibold text-foreground" numberOfLines={1}>
                  {t(screenTitleKey(s))}
                </Text>
                <Text className="font-mono text-[10.5px] text-muted-foreground">
                  {t(screenSubtitleKey(s)).toLowerCase()} · {doneN}/{nodes.length}
                </Text>
              </View>
              <ChevronRight size={16} color={C.muted} />
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        onPress={onSummary}
        className="mt-3 flex-row items-center justify-center gap-2 rounded-full bg-primary py-4 active:opacity-90"
      >
        <Text className="text-sm font-sans-semibold text-primary-foreground">
          {t("onboarding.index.seeSummary")}
        </Text>
        <ArrowRight size={16} color={C.onPrimary} />
      </Pressable>
    </Shell>
  );
}
