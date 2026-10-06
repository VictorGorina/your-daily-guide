import { RefreshCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import type { useHouseholdMutations } from "../../lib/use-household-mutations";

type Mutations = ReturnType<typeof useHouseholdMutations>;

/**
 * «Rehacer plan con la familia»: lo pide quien planifica; un cambio en la mesa
 * ya no lo dispara solo, solo deja el aviso (`tableChanged`).
 */
export function HouseholdRebuildCard({
  tableChanged,
  hasPlan,
  rebuild,
}: {
  tableChanged: boolean;
  hasPlan: boolean;
  rebuild: Mutations["rebuild"];
}) {
  const { t } = useTranslation();
  return (
    <View className="mt-4 rounded-3xl bg-surface p-5">
      <View className="flex-row items-center gap-2">
        <RefreshCw size={16} color="#6dbe7b" />
        <Text className="text-sm font-sans-semibold text-foreground">
          {t("hogar.rebuild.title")}
        </Text>
      </View>
      <Text className="mt-1 text-xs text-muted-foreground">{t("hogar.rebuild.intro")}</Text>
      {tableChanged ? (
        <View className="mt-3 rounded-2xl bg-primary-soft px-4 py-3">
          <Text className="text-xs text-primary-ink">{t("hogar.rebuild.changed")}</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => rebuild.mutate()}
        disabled={rebuild.isPending || !hasPlan}
        className="mt-3 flex-row items-center justify-center gap-2 rounded-full bg-primary py-3.5 active:opacity-90"
        style={rebuild.isPending || !hasPlan ? { opacity: 0.6 } : undefined}
      >
        {rebuild.isPending ? (
          <ActivityIndicator size="small" color="#3e3d39" />
        ) : (
          <RefreshCw size={16} color="#3e3d39" />
        )}
        <Text className="text-sm font-sans-semibold text-primary-foreground">
          {rebuild.isPending ? t("hogar.rebuild.running") : t("hogar.rebuild.submit")}
        </Text>
      </Pressable>
      {rebuild.isPending ? (
        <Text className="mt-2 text-center text-[11px] text-muted-foreground">
          {t("hogar.rebuild.wait")}
        </Text>
      ) : !hasPlan ? (
        <Text className="mt-2 text-center text-[11px] text-muted-foreground">
          {t("hogar.rebuild.noPlan")}
        </Text>
      ) : null}
    </View>
  );
}
