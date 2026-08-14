import { useEffect, useState } from "react";

export function ProgressBar({
  value,
  label,
  caption,
}: {
  value: number;
  label: string;
  caption?: string;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 120);
    return () => clearTimeout(t);
  }, [value]);

  const pct = Math.round(Math.max(0, Math.min(1, shown)) * 100);

  return (
    <div className="w-full">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{label}</p>
          {caption ? <p className="truncate text-[11px] text-muted-foreground">{caption}</p> : null}
        </div>
        <span className="font-display text-2xl tabular-nums text-foreground">{pct}%</span>
      </div>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary"
          style={{
            width: `${pct}%`,
            transition: "width 1.1s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
    </div>
  );
}
