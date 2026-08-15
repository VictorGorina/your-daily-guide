import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarDays, CalendarRange, Home, Settings } from "lucide-react";

// El coach ya no es una pestaña: vive como burbuja flotante (CoachFab) sobre
// cualquiera de estas cuatro pantallas, siempre a un toque de distancia.
const items = [
  { to: "/hoy", label: "Hoy", icon: Home },
  { to: "/plan", label: "Plan", icon: CalendarRange },
  { to: "/historial", label: "Historial", icon: CalendarDays },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto grid max-w-md grid-cols-4 gap-1 rounded-4xl border border-border bg-background/90 p-2 shadow-[0_18px_40px_-24px_oklch(0_0_0/45%)] backdrop-blur-xl">
        {items.map(({ to, label, icon: Icon }) => {
          const active = pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className="group flex flex-col items-center gap-1 rounded-3xl py-2 text-[10px] font-semibold transition-colors"
            >
              <span
                className={`grid h-10 w-10 place-items-center rounded-2xl transition-all duration-300 ${
                  active
                    ? "bg-primary text-primary-foreground scale-105"
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
