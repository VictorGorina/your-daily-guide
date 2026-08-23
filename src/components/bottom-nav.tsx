import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarRange, Home, Settings, Users } from "lucide-react";

import { fetchHousehold } from "@/lib/household";

// El coach ya no es una pestaña: vive como burbuja flotante (CoachFab) sobre
// cualquiera de estas pantallas, siempre a un toque de distancia. Historial
// tampoco es de primer nivel: vive como tercera sub-pestaña dentro de Plan.
const baseItems = [
  { to: "/hoy", label: "Hoy", icon: Home },
  { to: "/plan", label: "Plan", icon: CalendarRange },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
] as const;

const familyItem = { to: "/hogar", label: "Familia", icon: Users } as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Misma queryKey que /hogar: comparte caché, así que unirte o crear un
  // hogar allí hace aparecer esta pestaña sin petición extra.
  const household = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });
  const hasHousehold = Boolean(household.data?.household);

  // Insertamos "Familia" antes de "Ajustes" para que quede pegada al resto
  // de secciones de contenido en vez de al final, junto a la config.
  const items = hasHousehold
    ? [...baseItems.slice(0, 2), familyItem, ...baseItems.slice(2)]
    : baseItems;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-[30px] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div
        className={`mx-auto grid max-w-md gap-1 rounded-[26px] bg-surface/94 p-2 shadow-[0_6px_22px_-14px_rgba(0,0,0,.25)] backdrop-blur-[12px] ${
          hasHousehold ? "grid-cols-4" : "grid-cols-3"
        }`}
      >
        {items.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className="group flex flex-col items-center gap-1 rounded-3xl py-2 font-ui text-[9.5px] font-semibold transition-colors"
            >
              <span
                className={`grid h-8 w-[38px] place-items-center rounded-[14px] transition-all duration-300 ${
                  active
                    ? "bg-foreground text-background scale-105"
                    : "text-muted-foreground group-active:scale-95"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className={active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
