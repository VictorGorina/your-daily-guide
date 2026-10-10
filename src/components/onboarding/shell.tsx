import { X } from "lucide-react";
import type { ReactNode } from "react";

/** Marco de las pantallas del onboarding: el chat y los paneles que lo tapan. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex h-[100dvh] max-w-lg flex-col px-5 pb-5 pt-10">{children}</main>
  );
}

export function OverlayHeader({
  eyebrow,
  title,
  closeLabel,
  onClose,
}: {
  eyebrow: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="font-num text-[9.5px] uppercase tracking-[0.09em] text-muted-foreground">
          {eyebrow}
        </p>
        <h1 className="mt-0.5 font-display text-[22px] font-semibold tracking-tight">{title}</h1>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-foreground transition-transform active:scale-95"
      >
        <X className="h-[18px] w-[18px]" strokeWidth={2.2} />
      </button>
    </div>
  );
}
