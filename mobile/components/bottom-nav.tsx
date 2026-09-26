import { useQuery } from "@tanstack/react-query";
import { useRouter, usePathname } from "expo-router";
import { CalendarRange, Home, Settings, Users } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { fetchMonthlyPlan, fetchProfile, todayISO } from "../lib/daily";
import { fetchHousehold } from "../lib/household";
import { isNextMonthUnlocked, nextMonthISO } from "../lib/plan-shared";

// Mismas pestañas que la web (el coach vive como burbuja flotante y el
// historial como sub-pestaña de Plan, ninguno de primer nivel). Los href son
// las rutas de expo-router dentro del grupo (app). "Familia" solo aparece con
// hogar creado — igual que en la web (ver src/components/bottom-nav.tsx).
const baseItems = [
  { href: "/hoy", label: "Hoy", icon: Home },
  { href: "/plan", label: "Plan", icon: CalendarRange },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
] as const;

const familyItem = { href: "/hogar", label: "Familia", icon: Users } as const;

/**
 * ¿Tiene la pestaña Plan algo pendiente? El mes en curso sin plan, o el que
 * viene ya desbloqueado (su última semana, `isNextMonthUnlocked`) y sin plan:
 * es cuando toca la conversación con el coach y generar. Mismas queryKey que
 * la pantalla Plan, así el punto se apaga solo al generar. Réplica de la web
 * (`src/components/bottom-nav.tsx`).
 */
function usePlanNeedsAction() {
  const today = todayISO();
  const month = today.slice(0, 7);
  const nextMonth = nextMonthISO(today);
  const nextUnlocked = isNextMonthUnlocked(today);
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const onboarded = Boolean(profileQ.data?.onboarding_completed);
  const currentQ = useQuery({
    queryKey: ["plan", month],
    queryFn: () => fetchMonthlyPlan(month),
    enabled: onboarded,
  });
  const nextQ = useQuery({
    queryKey: ["plan", nextMonth],
    queryFn: () => fetchMonthlyPlan(nextMonth),
    enabled: onboarded && nextUnlocked,
  });
  if (!onboarded) return false;
  return (currentQ.isFetched && !currentQ.data) || (nextUnlocked && nextQ.isFetched && !nextQ.data);
}

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  // Misma queryKey que la pantalla de hogar: comparte caché, así que unirte o
  // crear un hogar allí hace aparecer esta pestaña sin petición extra.
  const householdQ = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });
  const hasHousehold = Boolean(householdQ.data?.household);
  const planNeedsAction = usePlanNeedsAction();

  const items = hasHousehold
    ? [...baseItems.slice(0, 2), familyItem, ...baseItems.slice(2)]
    : baseItems;

  return (
    <View className="absolute inset-x-0 bottom-0 px-[30px] pb-6">
      <View className="mx-auto w-full max-w-md flex-row gap-1 rounded-[26px] bg-surface/95 p-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Pressable
              key={href}
              onPress={() => router.navigate(href)}
              className="flex-1 items-center gap-1 rounded-3xl py-2 active:opacity-70"
            >
              <View
                className={`h-8 w-[38px] items-center justify-center rounded-[14px] ${
                  active ? "bg-foreground" : ""
                }`}
              >
                <Icon size={18} color={active ? "#f3f1ed" : "#83796c"} />
                {href === "/plan" && planNeedsAction ? (
                  <View
                    accessibilityLabel="Toca preparar tu plan"
                    className="absolute right-0.5 top-0 h-3 w-3 rounded-full border-2 border-surface bg-primary"
                  />
                ) : null}
              </View>
              <Text
                className={`text-[9.5px] font-body-semibold ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
