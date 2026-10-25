import { cn } from "@/lib/utils";

/**
 * Tres puntos que suben y bajan: «estoy trabajando» (el coach pensando, el
 * precalentado de Plan). Decorativos: el texto de al lado es el que dice qué
 * pasa. Con movimiento reducido se quedan quietos (`animate-coach-dot`).
 * Copia en `mobile/components/loading-dots.tsx`.
 */
export function LoadingDots({ small = false }: { small?: boolean }) {
  const dot = cn("rounded-full animate-coach-dot", small ? "h-1.5 w-1.5" : "h-2 w-2");
  return (
    <span aria-hidden className={cn("flex items-center", small ? "gap-0.5" : "gap-1")}>
      <span className={cn(dot, "bg-primary")} />
      <span className={cn(dot, "bg-primary/70 [animation-delay:0.15s]")} />
      <span className={cn(dot, "bg-primary/50 [animation-delay:0.3s]")} />
    </span>
  );
}
