import { ShieldCheck, Users } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";

import type { OpenSlot } from "../../lib/household";
import { personColor } from "../../lib/household-shared";
import type { useHouseholdMutations } from "../../lib/use-household-mutations";

type Mutations = ReturnType<typeof useHouseholdMutations>;

const INPUT = "h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground";

/**
 * Familia sin hogar todavía: unirse con el código de otra persona (y elegir
 * qué hueco de la mesa es el suyo) o crear uno. El código, los huecos
 * encontrados y el nombre son estado de este bloque.
 */
export function JoinOrCreateHousehold({
  create,
  lookup,
  claim,
}: Pick<Mutations, "create" | "lookup" | "claim">) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => t("hogar.create.defaultName"));
  const [code, setCode] = useState("");
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);

  return (
    <>
      <Text className="font-heading text-3xl text-foreground">{t("hogar.title")}</Text>
      <Text className="mt-2 text-sm text-muted-foreground">{t("hogar.intro")}</Text>

      <View className="mt-6 gap-2 rounded-3xl bg-primary-soft p-5">
        <Text className="text-sm font-sans-semibold text-foreground">{t("hogar.join.title")}</Text>
        <Text className="text-xs leading-5 text-muted-foreground">{t("hogar.join.hint")}</Text>
        {!slots ? (
          <>
            <TextInput
              className="mt-1 h-[60px] w-full rounded-2xl bg-surface px-4 text-center font-heading text-2xl uppercase tracking-widest text-foreground"
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              placeholder="ABC123"
              accessibilityLabel={t("hogar.join.codeLabel")}
              placeholderTextColor="#a69d8f"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => lookup.mutate(code, { onSuccess: setSlots })}
              disabled={lookup.isPending || code.trim().length < 4}
              className="mt-1 items-center rounded-full bg-primary py-3.5 active:opacity-90"
              style={lookup.isPending || code.trim().length < 4 ? { opacity: 0.6 } : undefined}
            >
              <Text className="text-sm font-sans-semibold text-primary-foreground">
                {lookup.isPending ? t("hogar.join.searching") : t("hogar.join.submit")}
              </Text>
            </Pressable>
          </>
        ) : slots.length ? (
          <View className="gap-2">
            <Text className="text-xs text-muted-foreground">{t("hogar.join.pickWho")}</Text>
            {slots.map((s) => {
              const pal = personColor(s.id);
              return (
                <Pressable
                  accessibilityRole="button"
                  key={s.id}
                  onPress={() =>
                    claim.mutate(
                      { code, memberId: s.id },
                      {
                        onSuccess: () => {
                          setCode("");
                          setSlots(null);
                        },
                      },
                    )
                  }
                  disabled={claim.isPending}
                  className="flex-row items-center gap-3 rounded-2xl bg-surface px-4 py-3 active:opacity-80"
                  style={claim.isPending ? { opacity: 0.6 } : undefined}
                >
                  <View
                    className="h-9 w-9 items-center justify-center rounded-full"
                    style={{ backgroundColor: pal.soft }}
                  >
                    <Text className="font-heading text-sm" style={{ color: pal.ink }}>
                      {(s.display_name.trim()[0] ?? "?").toUpperCase()}
                    </Text>
                  </View>
                  <Text className="text-sm font-sans-medium text-foreground">{s.display_name}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              onPress={() => setSlots(null)}
              className="active:opacity-70"
            >
              <Text className="text-xs font-sans-medium text-muted-foreground underline">
                {t("hogar.join.otherCode")}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View className="gap-2">
            <Text className="text-xs text-muted-foreground">{t("hogar.join.noSlots")}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSlots(null)}
              className="active:opacity-70"
            >
              <Text className="text-xs font-sans-medium text-muted-foreground underline">
                {t("hogar.join.otherCode")}
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      <View className="my-5 flex-row items-center gap-3">
        <View className="h-px flex-1 bg-border" />
        <Text className="text-[11px] font-sans-semibold uppercase tracking-widest text-muted-foreground">
          {t("hogar.orStart")}
        </Text>
        <View className="h-px flex-1 bg-border" />
      </View>

      <View className="gap-3 rounded-3xl bg-surface p-5">
        <View className="flex-row items-center gap-2">
          <Users size={16} color="#6dbe7b" />
          <Text className="text-sm font-sans-semibold text-foreground">
            {t("hogar.create.title")}
          </Text>
        </View>
        <Text className="text-xs text-muted-foreground">{t("hogar.create.hint")}</Text>
        <TextInput
          className={INPUT}
          value={name}
          onChangeText={setName}
          placeholder={t("hogar.create.nameLabel")}
          placeholderTextColor="#a69d8f"
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => create.mutate(name)}
          disabled={create.isPending}
          className="items-center rounded-full bg-secondary py-3.5 active:opacity-80"
          style={create.isPending ? { opacity: 0.6 } : undefined}
        >
          <Text className="text-sm font-sans-semibold text-foreground">
            {create.isPending ? t("hogar.create.creating") : t("hogar.create.submit")}
          </Text>
        </Pressable>
      </View>

      <View className="mt-4 flex-row items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3">
        <ShieldCheck size={16} color="#6dbe7b" style={{ marginTop: 1 }} />
        <Text className="flex-1 text-xs text-muted-foreground">{t("hogar.privacy")}</Text>
      </View>
    </>
  );
}
