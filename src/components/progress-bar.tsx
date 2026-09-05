import { useEffect, useState } from "react";

export function ProgressBar({
  value,
  label,
  caption,
  variant = "success",
}: {
  value: number;
  label: string;
  caption?: string;
  /** "success" = green (on track), "danger" = red (regressing). */
  variant?: "success" | "danger";
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 120);
    return () => clearTimeout(t);
  }, [value]);

  const pct = Math.round(Math.max(0, Math.min(1, shown)) * 100);
  const barColor = variant === "danger" ? "bg-destructive" : "bg-[#6dbe7b]";
  const pctColor = variant === "danger" ? "text-destructive" : "text-foreground";

  return (
    <div className="w-full">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{label}</p>
          {caption ? (
            <p className="truncate font-num text-[10.5px] text-muted-foreground">{caption}</p>
          ) : null}
        </div>
        <span className={`font-title text-2xl font-semibold tabular-nums ${pctColor}`}>{pct}%</span>
      </div>
      <div className="mt-3.5 h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{
            width: `${pct}%`,
            transition: "width 1.1s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </div>
    </div>
  );
}
