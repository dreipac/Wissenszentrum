import "./ValueChart.css";

interface ValueChartProps {
  values: number[];
  color: string;
}

const WIDTH = 600;
const HEIGHT = 180;
const PAD_X = 6;
const PAD_Y = 14;

/** Flächendiagramm als SVG (Dummy-Darstellung, ohne Achsenbeschriftung). */
export function ValueChart({ values, color }: ValueChartProps) {
  if (values.length < 2) return <div className="value-chart-empty">Noch keine Daten vorhanden.</div>;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const coords = values.map((v, i) => [
    PAD_X + (i / (values.length - 1)) * (WIDTH - PAD_X * 2),
    HEIGHT - PAD_Y - ((v - min) / range) * (HEIGHT - PAD_Y * 2),
  ]);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0]},${HEIGHT} L${coords[0][0]},${HEIGHT} Z`;
  const gradient = `value-fill-${color.replace(/[^a-z0-9]/gi, "")}`;
  const last = coords[coords.length - 1];

  return (
    <div className="value-chart">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Vermögensverlauf">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={WIDTH} y1={HEIGHT * f} y2={HEIGHT * f} className="value-chart-grid" />
        ))}
        <path d={area} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <span
        className="value-chart-dot"
        style={{ left: `${(last[0] / WIDTH) * 100}%`, top: `${(last[1] / HEIGHT) * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}
