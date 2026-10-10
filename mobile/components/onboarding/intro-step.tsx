import { ArrowRight, Sparkles } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { C } from "./shell";

/** Portada del onboarding: cuántas preguntas son y el botón de empezar. */
export function IntroStep({ total, onStart }: { total: number; onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center px-8">
        <Sparkles size={40} color={C.primary} />
        <Text className="mt-6 text-center font-heading text-2xl text-foreground">
          {t("onboarding.intro.title")}
        </Text>
        <Text className="mt-4 max-w-[300px] text-center text-sm leading-relaxed text-muted-foreground">
          {t("onboarding.intro.body", { count: total })}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onStart}
          className="mt-8 flex-row items-center gap-2 rounded-full bg-primary px-8 py-3.5 active:opacity-90"
        >
          <Text className="text-sm font-sans-semibold text-primary-foreground">
            {t("onboarding.intro.start")}
          </Text>
          <ArrowRight size={16} color={C.onPrimary} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
