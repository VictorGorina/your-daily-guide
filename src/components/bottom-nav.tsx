import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { CalendarRange, Home, Settings, Users } from "lucide-react";

import { fetchMonthlyPlan, fetchProfile, todayISO } from "@/lib/daily";
import { fetchHousehold } from "@/lib/household";
import { isNextMonthUnlocked, nextMonthISO } from "@/lib/plan-shared";

// El coach ya no es una pestaña: vive como burbuja flotante (CoachFab) sobre
// cualquiera de estas pantallas, siempre a un toque de distancia. Historial
// tampoco es de primer nivel: vive como tercera sub-pestaña dentro de Plan.
const baseItems = [
  { to: "/hoy", label: "Hoy", icon: Home },
  { to: "/plan", label: "Plan", icon: CalendarRange },
  { to: "/ajustes", label: "Ajustes", icon: Settings },
] as const;

const familyItem = { to: "/hogar", label: "Familia", icon: Users } as const;

/**
 * ¿Tiene la pestaña Plan algo pendiente? El mes en curso sin plan, o el que
 * viene ya desbloqueado (su última semana, `isNextMonthUnlocked`) y sin plan:
 * es cuando toca la conversación con el coach y generar. Mismas queryKey que
 * la pantalla Plan, así el punto se apaga solo al generar. Copia en
 * `mobile/components/bottom-nav.tsx`.
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Misma queryKey que /hogar: comparte caché, así que unirte o crear un
  // hogar allí hace aparecer esta pestaña sin petición extra.
  const household = useQuery({ queryKey: ["household"], queryFn: fetchHousehold });
  const hasHousehold = Boolean(household.data?.household);
  const planNeedsAction = usePlanNeedsAction();

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
                className={`relative grid h-8 w-[38px] place-items-center rounded-[14px] transition-all duration-300 ${
                  active
                    ? "bg-foreground text-background scale-105"
                    : "text-muted-foreground group-active:scale-95"
                }`}
              >
                <Icon className="h-[18px] w-[18px]" />
                {to === "/plan" && planNeedsAction ? (
                  <span
                    aria-label="Toca preparar tu plan"
                    className="absolute right-1 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-surface"
                  />
                ) : null}
              </span>
              <span className={active ? "text-foreground" : "text-muted-foreground"}>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
