import { useRouter, usePathname } from "expo-router";
import { CalendarDays, CalendarRange, Home, Settings } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

// Mismas cuatro pestañas que la web (el coach vive como burbuja flotante, no
// como pestaña). Los href son las rutas de expo-router dentro del grupo (app).
const items = [
  { href: "/hoy", label: "Hoy", icon: Home },
  { href: "/plan", label: "Plan", icon: CalendarRange },
  { href: "/historial", label: "Historial", icon: CalendarDays },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
] as const;

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View className="absolute inset-x-0 bottom-0 px-4 pb-6">
      <View className="mx-auto w-full max-w-md flex-row gap-1 rounded-3xl border border-border bg-background/95 p-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Pressable
              key={href}
              onPress={() => router.navigate(href)}
              className="flex-1 items-center gap-1 rounded-3xl py-2 active:opacity-70"
            >
              <View
                className={`h-10 w-10 items-center justify-center rounded-2xl ${
                  active ? "bg-primary" : ""
                }`}
              >
                <Icon size={18} color={active ? "#f9fcff" : "#677380"} />
              </View>
              <Text
                className={`text-[10px] font-semibold ${
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
