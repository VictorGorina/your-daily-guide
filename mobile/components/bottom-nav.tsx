import { useQuery } from "@tanstack/react-query";
import { useRouter, usePathname } from "expo-router";
import { CalendarRange, Home, Settings, Users } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { fetchHousehold } from "../lib/household";

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

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  // Misma queryKey que la pantalla de hogar: comparte caché, así que unirte o
  // crear un hogar allí hace aparecer esta pestaña sin petición extra.
  const householdQ = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });
  const hasHousehold = Boolean(householdQ.data?.household);

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
