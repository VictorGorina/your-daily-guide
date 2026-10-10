import { Check } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import { C, Shell } from "./shell";

type Props = {
  answeredCount: number;
  total: number;
  onContinue: () => void;
  onReview: () => void;
};

/** "Guardar y salir": confirma que el progreso queda guardado. */
export function SavedPanel({ answeredCount, total, onContinue, onReview }: Props) {
  const { t } = useTranslation();
  return (
    <Shell>
      <View className="flex-1 items-center justify-center gap-6">
        <View className="h-24 w-24 items-center justify-center">
          <View className="absolute h-24 w-24 rounded-full bg-primary/10" />
          <View className="h-14 w-14 items-center justify-center rounded-full bg-primary-soft">
            <Check size={24} color={C.primary} />
          </View>
        </View>
        <Text className="font-display text-2xl text-foreground">{t("onboarding.saved.title")}</Text>
        <Text className="max-w-[300px] text-center text-sm leading-relaxed text-muted-foreground">
          {t("onboarding.saved.body", { done: answeredCount, total })}
        </Text>
        <View className="w-full max-w-[320px] gap-2.5">
          <Pressable
            accessibilityRole="button"
            onPress={onContinue}
            className="items-center rounded-full bg-primary py-4 active:opacity-90"
          >
            <Text className="text-sm font-sans-semibold text-primary-foreground">
              {t("onboarding.saved.continue")}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onReview}
            className="items-center rounded-full bg-surface py-4 active:opacity-90"
          >
            <Text className="text-sm font-sans-semibold text-muted-foreground">
              {t("onboarding.saved.review")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Shell>
  );
}
