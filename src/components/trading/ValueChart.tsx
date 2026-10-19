import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { formatMoney } from "../../lib/format";
import type { SeriesPoint } from "../../lib/tradingSeries";
import "./ValueChart.css";

interface ValueChartProps {
  points: SeriesPoint[];
  color: string;
  /** Kurse laufen live: der letzte Punkt pulsiert */
  live?: boolean;
  /** Stufenlinie des eingezahlten Kapitals, als Bezug gestrichelt gezeichnet */
  reference?: SeriesPoint[];
  /** Beschriftung der Bezugslinie (Standard: „Eingezahlt“) */
  referenceLabel?: string;
  /** Wert im Hover (Standard: CHF mit zwei Stellen) */
  format?: (value: number) => string;
  /** Beschriftung der senkrechten Achse; bekommt die Spanne der Achse (Standard: ganze Franken) */
  axis?: (value: number, span: number) => string;
  /** Legende unter dem Diagramm bei vorhandener Bezugslinie */
  legend?: boolean;
  ariaLabel?: string;
  /** Markierungen auf der Linie (z. B. Logbuch-Einträge); vor dem Zeitraum werden sie weggelassen, spätere sitzen am Ende der Linie */
  markers?: ChartMarker[];
}

export interface ChartMarker {
  t: number;
  label: string;
  color: string;
}

const HEIGHT = 230;
const PAD = { left: 62, right: 16, top: 14, bottom: 28 };
const DAY = 86_400_000;

const number = new Intl.NumberFormat("de-CH", { maximumFractionDigits: 0 });
const decimals = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Achsenbeschriftung: ganze Franken, bei sehr kleinen Schwankungen mit Rappen. */
const yLabel = (v: number, span: number) => (span < 20 ? decimals.format(v) : number.format(v));

function xLabel(t: number, span: number): string {
  const d = new Date(t);
  // Bei sehr kurzem Verlauf sind Minuten allein nicht unterscheidbar
  if (span < 20 * 60_000) return d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (span <= 1.6 * DAY) return d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  if (span <= 400 * DAY) return d.toLocaleDateString("de-CH", { day: "numeric", month: "short" });
  return d.toLocaleDateString("de-CH", { month: "short", year: "2-digit" });
}

const tooltipTime = (t: number) =>
  new Date(t).toLocaleString("de-CH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Verlauf des Vermögens als Flächendiagramm mit Achsen und Hover. Misst seine Breite selbst, damit nichts verzerrt wird. */
export function ValueChart({ points, color, live, reference = [], referenceLabel = "Eingezahlt", format = formatMoney, axis = yLabel, legend = true, ariaLabel = "Vermögensverlauf", markers = [] }: ValueChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth || 600);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 600));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const values = [...points.map((p) => p.v), ...reference.map((p) => p.v)];
    let min = Math.min(...values);
    let max = Math.max(...values);
    // Etwas Luft oben und unten; ein flacher Verlauf bekommt eine kleine Spanne um den Wert
    const pad = max === min ? Math.max(Math.abs(max) * 0.005, 1) : (max - min) * 0.12;
    min -= pad;
    max += pad;
    const w = Math.max(width - PAD.left - PAD.right, 10);
    const h = HEIGHT - PAD.top - PAD.bottom;
    const x = (t: number) => PAD.left + (t1 === t0 ? w : ((t - t0) / (t1 - t0)) * w);
    const y = (v: number) => PAD.top + h - ((v - min) / (max - min)) * h;
    return { t0, t1, min, max, x, y, h };
  }, [points, reference, width]);

  const { t0, t1, min, max, x, y, h } = geometry;
  const coords = points.map((p) => [x(p.t), y(p.v)] as const);
  const line = coords.map(([cx, cy], i) => `${i === 0 ? "M" : "L"}${cx.toFixed(1)},${cy.toFixed(1)}`).join(" ");
  const bottom = PAD.top + h;
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${bottom} L${coords[0][0].toFixed(1)},${bottom} Z`;
  // Eingezahltes Kapital als Treppe: waagerecht bis zur nächsten Einzahlung, dann senkrecht
  const refPath = reference
    .map((p, i) => (i === 0 ? `M${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}` : `H${x(p.t).toFixed(1)} V${y(p.v).toFixed(1)}`))
    .join(" ");
  const gradient = `value-fill-${color.replace(/[^a-z0-9]/gi, "")}`;
  const span = t1 - t0;

  const yTicks = [max, (max + min) / 2, min].map((v) => ({ v, y: y(v) }));
  const xTicks = [0, 1 / 3, 2 / 3, 1].map((f) => ({ t: t0 + span * f, f }));

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestDist = Infinity;
    coords.forEach(([cx], i) => {
      const dist = Math.abs(cx - px);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setHover(best);
  };

  const shown = hover !== null ? points[hover] : null;
  const last = coords[coords.length - 1];
  const tipLeft = shown ? Math.min(Math.max(x(shown.t), PAD.left + 70), width - PAD.right - 70) : 0;

  return (
    <div className="value-chart-box">
    <div ref={wrap} className="value-chart" style={{ height: HEIGHT }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.24" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={t.y} y2={t.y} className="value-chart-grid" />
            <text x={PAD.left - 10} y={t.y + 4} textAnchor="end" className="value-chart-label">
              {axis(t.v, max - min)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text
            key={t.f}
            x={x(t.t)}
            y={HEIGHT - 8}
            textAnchor={t.f === 0 ? "start" : t.f === 1 ? "end" : "middle"}
            className="value-chart-label"
          >
            {xLabel(t.t, span)}
          </text>
        ))}
        {refPath && <path d={refPath} fill="none" className="value-chart-ref" />}
        {refPath && (
          <text x={width - PAD.right} y={y(reference[reference.length - 1].v) - 6} textAnchor="end" className="value-chart-ref-label">
            {referenceLabel} {axis(reference[reference.length - 1].v, max - min)}
          </text>
        )}
        <path d={area} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {shown && <line x1={x(shown.t)} x2={x(shown.t)} y1={PAD.top} y2={bottom} className="value-chart-cross" />}
        {markers
          // Einträge nach dem letzten Punkt (Börse zu, „jetzt“) sitzen am Ende der Linie
          .filter((m) => m.t >= t0)
          .map((marker, i) => {
            const m = { ...marker, t: Math.min(marker.t, t1) };
            // Auf die Linie setzen: Kurs des nächstgelegenen Punkts
            let nearest = points[0];
            for (const pt of points) if (Math.abs(pt.t - m.t) < Math.abs(nearest.t - m.t)) nearest = pt;
            return (
              <g key={`${m.t}-${i}`} className="value-chart-marker">
                <circle cx={x(m.t)} cy={y(nearest.v)} r="9" fill="transparent" />
                <circle cx={x(m.t)} cy={y(nearest.v)} r="5" fill="var(--bg-card)" stroke={m.color} strokeWidth="2" />
                <title>{m.label}</title>
              </g>
            );
          })}
        {live && <circle cx={last[0]} cy={last[1]} r="5" fill={color} className="value-chart-pulse" />}
        <circle cx={last[0]} cy={last[1]} r="4.5" fill={color} stroke="var(--bg-card)" strokeWidth="2" />
        {shown && <circle cx={x(shown.t)} cy={y(shown.v)} r="4.5" fill="var(--bg-card)" stroke={color} strokeWidth="2" />}
      </svg>
      {shown && (
        <div className="value-chart-tip" style={{ left: tipLeft, top: Math.max(y(shown.v) - 58, 0) }}>
          <strong>{format(shown.v)}</strong>
          <span>{tooltipTime(shown.t)}</span>
        </div>
      )}
    </div>
    {refPath && legend && (
      <div className="value-chart-legend">
        <span>
          <i className="line" style={{ backgroundColor: color }} />
          Vermögen
        </span>
        <span>
          <i className="dash" />
          Eingezahlt
        </span>
      </div>
    )}
    </div>
  );
}
