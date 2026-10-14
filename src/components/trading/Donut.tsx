import { formatMoney } from "../../lib/format";
import "./Donut.css";

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

const SIZE = 148;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Ringdiagramm mit Legende (Dummy-Darstellung). */
export function Donut({ segments }: { segments: DonutSegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let offset = 0;

  return (
    <div className="donut">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Verteilung">
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--bg-selected)" strokeWidth={STROKE} />
          {segments
            .filter((s) => s.value > 0)
            .map((s) => {
              const dash = (s.value / total) * CIRCUMFERENCE;
              const circle = (
                <circle
                  key={s.label}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${Math.max(dash - 2, 0)} ${CIRCUMFERENCE - Math.max(dash - 2, 0)}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += dash;
              return circle;
            })}
        </g>
      </svg>
      <ul className="donut-legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="dot" style={{ backgroundColor: s.color }} />
            <span className="donut-label">{s.label}</span>
            <span className="donut-pct">{((s.value / total) * 100).toFixed(1)} %</span>
            <span className="donut-value">{formatMoney(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
