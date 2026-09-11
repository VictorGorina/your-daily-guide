/**
 * Indicador visual de peso actual vs peso objetivo.
 *
 * Reemplaza la barra de progreso lineal con una escala horizontal que muestra:
 * - El peso objetivo como referencia central
 * - El peso actual como un punto coloreado
 * - Una franja ±1 kg alrededor del objetivo ("zona de mantenimiento")
 * - Etiquetas de peso en los extremos y en los marcadores
 *
 * El rango de la escala se calcula dinámicamente para que tanto el start, el
 * current como el target quepan con un padding visual cómodo.
 */

type Props = {
  targetKg: number;
  currentKg: number;
  startKg: number;
  /** True cuando el peso se aleja del objetivo. */
  regressing: boolean;
  /** "toward" | "away" | "stable" — dirección de la tendencia reciente. */
  trendDirection?: "toward" | "away" | "stable";
};

/** Cuántos kg de margen visual se añaden a cada extremo de la escala. */
const PADDING_KG = 3;
/** Ancho de la zona de mantenimiento en kg (±1 kg). */
const MAINTAIN_ZONE = 1;

export function WeightGauge({ targetKg, currentKg, startKg, regressing, trendDirection }: Props) {
  const rangeMin = Math.min(targetKg, currentKg, startKg) - PADDING_KG;
  const rangeMax = Math.max(targetKg, currentKg, startKg) + PADDING_KG;
  const rangeSpan = rangeMax - rangeMin;

  /** Convierte kg absolutos a porcentaje horizontal (0-100). */
  const pct = (kg: number) => ((kg - rangeMin) / rangeSpan) * 100;

  const targetPct = pct(targetKg);
  const currentPct = pct(currentKg);
  const zoneLPct = pct(targetKg - MAINTAIN_ZONE);
  const zoneRPct = pct(targetKg + MAINTAIN_ZONE);

  const distanceKg = Math.abs(currentKg - targetKg);
  const inZone = distanceKg <= MAINTAIN_ZONE;

  // Colores del design system
  const dotColor = inZone
    ? "#6DBE7B" // Verde fresco — en zona de mantenimiento
    : regressing
      ? "#E57373" // Rojo suave — alejándose
      : "#FF8A3D"; // Naranja Peppers — acercándose

  const trendArrow = trendDirection === "toward" ? "→" : trendDirection === "away" ? "←" : null;

  const distanceLabel =
    distanceKg < 0.5
      ? "En tu peso"
      : `${distanceKg.toFixed(1)} kg ${currentKg > targetKg ? "por encima" : "por debajo"}`;

  return (
    <div className="w-full">
      {/* Cabecera: peso objetivo + distancia */}
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          Objetivo: <span className="font-num tabular-nums">{targetKg}</span> kg
        </p>
        <span className="font-num text-xs tabular-nums" style={{ color: dotColor }}>
          {distanceLabel}
        </span>
      </div>

      {/* Escala SVG */}
      <svg
        viewBox="0 0 300 40"
        preserveAspectRatio="xMidYMid meet"
        className="w-full"
        role="img"
        aria-label={`Peso actual ${currentKg} kg, objetivo ${targetKg} kg`}
      >
        {/* Raíl de fondo */}
        <rect x="10" y="14" width="280" height="6" rx="3" fill="#EAE6DD" />

        {/* Zona de mantenimiento (±1 kg alrededor del target) */}
        <rect
          x={10 + (zoneLPct / 100) * 280}
          y="10"
          width={((zoneRPct - zoneLPct) / 100) * 280}
          height="14"
          rx="3"
          fill="#6DBE7B"
          opacity="0.18"
        />

        {/* Línea del target */}
        <line
          x1={10 + (targetPct / 100) * 280}
          y1="8"
          x2={10 + (targetPct / 100) * 280}
          y2="26"
          stroke="#6DBE7B"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Punto del peso actual */}
        <circle cx={10 + (currentPct / 100) * 280} cy="17" r="6" fill={dotColor} />

        {/* Flecha de tendencia junto al punto */}
        {trendArrow && (
          <text
            x={10 + (currentPct / 100) * 280 + (currentKg < targetKg ? 10 : -10)}
            y="21"
            textAnchor="middle"
            className="text-[8px]"
            fill={dotColor}
          >
            {trendArrow}
          </text>
        )}

        {/* Etiqueta del target */}
        <text
          x={10 + (targetPct / 100) * 280}
          y="38"
          textAnchor="middle"
          className="font-num text-[8px] tabular-nums"
          fill="#6DBE7B"
        >
          {targetKg}
        </text>

        {/* Etiqueta del peso actual (solo si no solapa con el target) */}
        {Math.abs(currentPct - targetPct) > 8 && (
          <text
            x={10 + (currentPct / 100) * 280}
            y="38"
            textAnchor="middle"
            className="font-num text-[8px] tabular-nums"
            fill={dotColor}
          >
            {currentKg}
          </text>
        )}
      </svg>
    </div>
  );
}
