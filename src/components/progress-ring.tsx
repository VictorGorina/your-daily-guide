import { useEffect, useState } from "react";

export function ProgressRing({
  value,
  size = 200,
  label,
  caption,
}: {
  value: number;
  size?: number;
  label: string;
  caption?: string;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), 120);
    return () => clearTimeout(t);
  }, [value]);

  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <div className="absolute inset-6 rounded-full bg-primary-soft blur-2xl animate-breathe" />
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-secondary)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-primary)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - c * Math.max(0, Math.min(1, shown))}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-title text-4xl font-semibold tabular-nums text-foreground">
          {Math.round(shown * 100)}%
        </span>
        <span className="mt-1 text-xs font-medium text-muted-foreground">{label}</span>
        {caption ? (
          <span className="mt-0.5 text-[11px] text-muted-foreground/80">{caption}</span>
        ) : null}
      </div>
    </div>
  );
}
