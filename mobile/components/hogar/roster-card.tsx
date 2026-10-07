import { Baby, ChefHat, ChevronRight, ShieldCheck, UserPlus } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";

import type { HouseholdChild, HouseholdMember } from "../../lib/household";
import { eatsTableFood, personColor, type Appetite } from "../../lib/household-shared";
import type { useHouseholdMutations } from "../../lib/use-household-mutations";
import { ChildMealGapBanner } from "../child-meal-gap-banner";

type Mutations = ReturnType<typeof useHouseholdMutations>;
type RowActions = Pick<
  Mutations,
  "renameMember" | "setMemberPortion" | "markUsesApp" | "makePlanner" | "dropMember"
>;

const INPUT = "h-12 w-full rounded-2xl bg-muted px-4 text-sm text-foreground";

/**
 * Apetito → peso de ración para dimensionar la compra (adultos; los niños usan
 * `childPortion`). La etiqueta sale del catálogo (`appetite.<clave>`).
 */
const APPETITES: readonly [Appetite, number][] = [
  ["poco", 0.8],
  ["normal", 1],
  ["mucho", 1.2],
];
const portionFor = (a: Appetite) => APPETITES.find(([key]) => key === a)![1];

/**
 * La mesa del hogar: adultos primero, luego los peques que comen de la mesa y,
 * en su propio grupo, los bebés. Debajo, el formulario de añadir — solo para
 * quien gestiona la mesa (`canManageRoster`: el creador o quien planifica).
 * Abrir la ficha de un peque (o una nueva, con `null`) lo hace la pantalla.
 */
export function HouseholdRosterCard({
  members,
  kids,
  meUserId,
  canManageRoster,
  pendingKidNames,
  addAdult,
  fillKids,
  onOpenChild,
  ...rowActions
}: {
  members: HouseholdMember[];
  kids: HouseholdChild[];
  meUserId: string | null | undefined;
  canManageRoster: boolean;
  /** Bebés de triturados a los que aún les falta su puré en el plan. */
  pendingKidNames: string[];
  addAdult: Mutations["addAdult"];
  fillKids: Mutations["fillKids"];
  onOpenChild: (child: HouseholdChild | null) => void;
} & RowActions) {
  const { t } = useTranslation();
  // Los bebés que aún no comen de la mesa van en su propio grupo.
  const tableKids = kids.filter((c) => eatsTableFood(c.feeding_stage));
  const babies = kids.filter((c) => !eatsTableFood(c.feeding_stage));
  const renderChild = (c: HouseholdChild) => (
    <ChildRow key={c.id} c={c} onPress={() => onOpenChild(c)} />
  );
  return (
    <View className="mt-4 rounded-3xl bg-surface p-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-sans-semibold text-foreground">
          {t("hogar.roster.title")}
        </Text>
        <Text className="text-[11px] text-muted-foreground">
          {t("hogar.roster.count", { count: members.length + kids.length })}
        </Text>
      </View>

      {/* --- Lista unificada: adultos primero, luego peques --- */}
      <View className="mt-4 gap-2">
        {members.map((m) => (
          <AdultRow
            key={m.id}
            m={m}
            meUserId={meUserId}
            canManageRoster={canManageRoster}
            {...rowActions}
          />
        ))}

        {tableKids.map(renderChild)}

        {babies.length ? (
          <View className="mt-1 gap-2">
            <Text className="text-[11px] font-sans-semibold uppercase tracking-wider text-muted-foreground">
              {t("hogar.roster.babies")}
            </Text>
            {babies.map(renderChild)}
            <ChildMealGapBanner
              names={pendingKidNames}
              pending={fillKids.isPending}
              onUpdate={() => fillKids.mutate()}
            />
          </View>
        ) : null}
      </View>

      {/* --- Añadir miembro: adulto o peque --- */}
      {canManageRoster ? (
        <AddMemberForm addAdult={addAdult} onAddChild={() => onOpenChild(null)} />
      ) : (
        // Explicar en vez de ocultar: antes este bloque simplemente
        // desaparecía para quien no era el creador, sin decir por qué.
        <View className="mt-3 rounded-2xl bg-secondary/60 px-4 py-3">
          <Text className="text-[11.5px] leading-5 text-muted-foreground">
            {t("hogar.roster.onlyManagers")}
          </Text>
        </View>
      )}

      <View className="mt-4 flex-row items-start gap-2.5 rounded-2xl bg-muted px-3.5 py-3">
        <ShieldCheck size={14} color="#6b6256" style={{ marginTop: 1 }} />
        <Text className="flex-1 text-[11.5px] leading-5 text-muted-foreground">
          {t("hogar.roster.profileNote")}
        </Text>
      </View>
    </View>
  );
}

function AdultRow({
  m,
  meUserId,
  canManageRoster,
  renameMember,
  setMemberPortion,
  markUsesApp,
  makePlanner,
  dropMember,
}: {
  m: HouseholdMember;
  meUserId: string | null | undefined;
  canManageRoster: boolean;
} & RowActions) {
  const { t } = useTranslation();
  const isMe = !!m.user_id && m.user_id === meUserId;
  const initial = (m.display_name.trim()[0] ?? "?").toUpperCase();
  const pal = personColor(m.id);
  return (
    <View className="rounded-2xl bg-secondary px-4 py-3">
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-full"
          style={{ backgroundColor: pal.soft }}
        >
          <Text className="font-heading text-[15px]" style={{ color: pal.ink }}>
            {initial}
          </Text>
        </View>
        {canManageRoster && !isMe ? (
          <TextInput
            className="flex-1 rounded-lg bg-muted px-2 py-1 text-sm text-foreground"
            defaultValue={m.display_name}
            placeholderTextColor="#a69d8f"
            onEndEditing={(e) => renameMember(m.id, e.nativeEvent.text)}
          />
        ) : (
          <Text className="flex-1 text-sm font-sans-medium text-foreground">{m.display_name}</Text>
        )}
        <View className="flex-row items-center gap-1">
          {m.is_planner ? (
            <View className="flex-row items-center gap-1 rounded-full bg-primary-soft px-2 py-1">
              <ChefHat size={12} color="#6dbe7b" />
              <Text className="text-[11px] font-sans-medium text-primary-ink">
                {t("hogar.roster.planner")}
              </Text>
            </View>
          ) : null}
          {isMe ? (
            <Text className="rounded-full bg-surface px-2 py-1 text-[11px] font-sans-medium text-muted-foreground">
              {t("hogar.roster.you")}
            </Text>
          ) : !m.uses_app ? (
            <Text className="rounded-full bg-surface px-2 py-1 text-[11px] font-sans-medium text-muted-foreground">
              {t("hogar.roster.noAccount")}
            </Text>
          ) : !m.user_id ? (
            <Text className="rounded-full bg-surface px-2 py-1 text-[11px] font-sans-medium text-muted-foreground">
              {t("hogar.roster.pending")}
            </Text>
          ) : null}
        </View>
      </View>

      <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
        <Text className="text-[11px] text-muted-foreground">{t("hogar.roster.portion")}</Text>
        {APPETITES.map(([key, value]) => {
          const active = Math.abs(m.portion - value) < 0.01;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={key}
              disabled={!canManageRoster}
              onPress={() => setMemberPortion(m.id, value)}
              className={`rounded-full px-2 py-0.5 ${active ? "bg-primary-soft" : "bg-surface"}`}
              style={canManageRoster ? undefined : { opacity: 0.7 }}
            >
              <Text
                className={`text-[11px] font-sans-medium ${
                  active ? "text-primary-ink" : "text-muted-foreground"
                }`}
              >
                {t(`appetite.${key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {canManageRoster && !isMe ? (
        <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
          {!m.uses_app ? (
            <Pressable accessibilityRole="button" onPress={() => markUsesApp.mutate(m.id)}>
              <Text className="text-[11px] font-sans-medium text-primary-ink underline">
                {t("hogar.roster.usesAppNow")}
              </Text>
            </Pressable>
          ) : null}
          {m.user_id && !m.is_planner ? (
            <Pressable accessibilityRole="button" onPress={() => makePlanner.mutate(m.id)}>
              <Text className="text-[11px] font-sans-medium text-muted-foreground underline">
                {t("hogar.roster.makePlanner")}
              </Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => dropMember.mutate(m.id)}>
            <Text className="text-[11px] font-sans-medium text-destructive underline">
              {t("hogar.roster.remove")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ChildRow({ c, onPress }: { c: HouseholdChild; onPress: () => void }) {
  const { t } = useTranslation();
  const pal = personColor(c.id);
  // Quien aún no come de la mesa enseña su etapa en vez de alergias y apetito.
  const note = eatsTableFood(c.feeding_stage) ? "" : t(`hogar.child.stageNote.${c.feeding_stage}`);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl bg-secondary px-4 py-3 active:opacity-80"
    >
      <View
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: pal.soft }}
      >
        <Baby size={20} color={pal.ink} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-sans-medium text-foreground">
          {c.name}
          {c.age ? ` · ${t("hogar.child.age", { count: c.age })}` : ""}
        </Text>
        <Text className="mt-0.5 text-xs text-muted-foreground">
          {note
            ? note
            : t("hogar.child.summary", {
                allergies: c.allergies
                  ? t("hogar.child.allergies", { list: c.allergies.toLowerCase() })
                  : t("hogar.child.noAllergies"),
                appetite: t(`appetite.lower.${c.appetite ?? "normal"}`, {
                  defaultValue: c.appetite ?? "normal",
                }),
              })}
        </Text>
      </View>
      <ChevronRight size={18} color="#6b6256" />
    </Pressable>
  );
}

function AddMemberForm({
  addAdult,
  onAddChild,
}: {
  addAdult: Mutations["addAdult"];
  onAddChild: () => void;
}) {
  const { t } = useTranslation();
  const [addingType, setAddingType] = useState<"adult" | "child">("adult");
  const [newAdult, setNewAdult] = useState<{ name: string; usesApp: boolean; appetite: Appetite }>({
    name: "",
    usesApp: true,
    appetite: "normal",
  });
  return (
    <View className="mt-3 gap-2 rounded-2xl bg-secondary/60 p-4">
      <Text className="text-xs font-sans-semibold text-foreground">{t("hogar.add.title")}</Text>

      <View className="flex-row gap-2">
        {(
          [
            ["adult", "hogar.add.adult"],
            ["child", "hogar.add.child"],
          ] as const
        ).map(([key, labelKey]) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: addingType === key }}
            key={key}
            onPress={() => setAddingType(key)}
            className={`flex-1 items-center rounded-xl py-2.5 ${
              addingType === key ? "bg-primary-soft" : "bg-surface"
            }`}
          >
            <Text
              className={`text-xs font-sans-medium ${
                addingType === key ? "text-primary-ink" : "text-muted-foreground"
              }`}
            >
              {t(labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      {addingType === "adult" ? (
        <>
          <TextInput
            className={INPUT}
            value={newAdult.name}
            onChangeText={(v) => setNewAdult((p) => ({ ...p, name: v }))}
            placeholder={t("hogar.add.name")}
            accessibilityLabel={t("hogar.add.adultNameLabel")}
            placeholderTextColor="#a69d8f"
          />
          <View className="flex-row gap-2">
            {(
              [
                [true, "hogar.add.usesApp"],
                [false, "hogar.add.noApp"],
              ] as const
            ).map(([value, labelKey]) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: newAdult.usesApp === value }}
                key={labelKey}
                onPress={() => setNewAdult((p) => ({ ...p, usesApp: value }))}
                className={`flex-1 items-center rounded-xl py-2 ${
                  newAdult.usesApp === value ? "bg-primary-soft" : "bg-surface"
                }`}
              >
                <Text
                  className={`text-xs font-sans-medium ${
                    newAdult.usesApp === value ? "text-primary-ink" : "text-muted-foreground"
                  }`}
                >
                  {t(labelKey)}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-row items-center gap-1.5">
            <Text className="text-[11px] text-muted-foreground">{t("hogar.roster.portion")}</Text>
            {APPETITES.map(([key]) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: newAdult.appetite === key }}
                key={key}
                onPress={() => setNewAdult((p) => ({ ...p, appetite: key }))}
                className={`rounded-full px-2.5 py-1 ${
                  newAdult.appetite === key ? "bg-primary-soft" : "bg-surface"
                }`}
              >
                <Text
                  className={`text-[11px] font-sans-medium ${
                    newAdult.appetite === key ? "text-primary-ink" : "text-muted-foreground"
                  }`}
                >
                  {t(`appetite.${key}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              addAdult.mutate(
                {
                  name: newAdult.name,
                  usesApp: newAdult.usesApp,
                  portion: portionFor(newAdult.appetite),
                },
                {
                  onSuccess: () => setNewAdult({ name: "", usesApp: true, appetite: "normal" }),
                },
              )
            }
            disabled={addAdult.isPending || !newAdult.name.trim()}
            className="flex-row items-center justify-center gap-2 rounded-full bg-secondary py-2.5 active:opacity-80"
            style={addAdult.isPending || !newAdult.name.trim() ? { opacity: 0.6 } : undefined}
          >
            <UserPlus size={16} color="#3e3d39" />
            <Text className="text-sm font-sans-medium text-foreground">
              {t("hogar.add.addAdult")}
            </Text>
          </Pressable>
          <Text className="text-[11px] text-muted-foreground">{t("hogar.add.hint")}</Text>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => onAddChild()}
          className="flex-row items-center justify-center gap-2 rounded-full bg-secondary py-2.5 active:opacity-80"
        >
          <Baby size={16} color="#3e3d39" />
          <Text className="text-sm font-sans-medium text-foreground">
            {t("hogar.add.addChild")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
