import { useEffect, useMemo, useState } from "react";
import { loadAssetChart, loadAssetProfile } from "../../lib/api/assets";
import { ASSET_RANGES, formatCompact, type AssetChart, type AssetProfile, type AssetRange } from "../../lib/assetInfo";
import { formatPercent, formatSigned } from "../../lib/format";
import { formatPrice, type TradeAssetClass } from "../../lib/trading";
import { ValueChart, type ChartMarker } from "./ValueChart";
import "./AssetInsight.css";

interface AssetInsightProps {
  symbol: string;
  assetClass: TradeAssetClass;
  /** Währung der Position, falls der Kursanbieter keine nennt */
  currency: string;
  /** Aktueller Kurs aus der App (Live-Kurs); sonst gilt der letzte Punkt des Verlaufs */
  price?: number | null;
  /** Durchschnittlicher Einstieg: wird als gestrichelte Linie eingezeichnet */
  entry?: number | null;
  /** Logbuch-Einträge als Markierungen auf der Linie */
  markers?: ChartMarker[];
}

// Kurz zwischenspeichern, damit Zurückwechseln zwischen Zeiträumen und erneutes Öffnen sofort geht
const CACHE_MS = 60_000;
const chartCache = new Map<string, { at: number; chart: AssetChart }>();
const profileCache = new Map<string, AssetProfile>();

const axisLabel = (v: number, span: number) =>
  v.toLocaleString("de-CH", { minimumFractionDigits: 0, maximumFractionDigits: span >= 100 ? 0 : span >= 0.5 ? 2 : 4 });

/**
 * Kursverlauf mit Zeitraum-Auswahl und den wichtigsten Kennzahlen eines Wertpapiers. Daten kommen vom Kursanbieter
 * (Verlauf, Spannen) und – bei Aktien mit Finnhub-Key – von Finnhub (Branche, Land, Börsenwert).
 */
export function AssetInsight({ symbol, assetClass, currency, price = null, entry = null, markers }: AssetInsightProps) {
  const [range, setRange] = useState<AssetRange>("1M");
  const [chart, setChart] = useState<AssetChart | null>(null);
  const [shown, setShown] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<AssetProfile | null>(profileCache.get(symbol) ?? null);

  useEffect(() => {
    const key = `${symbol}|${range}`;
    const cached = chartCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) {
      setChart(cached.chart);
      setShown(key);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadAssetChart(symbol, range)
      .then((c) => {
        if (cancelled) return;
        chartCache.set(key, { at: Date.now(), chart: c });
        setChart(c);
        setShown(key);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [symbol, range]);

  useEffect(() => {
    if (assetClass !== "aktie" || profileCache.has(symbol)) return;
    let cancelled = false;
    loadAssetProfile(symbol)
      .then((p) => {
        profileCache.set(symbol, p);
        if (!cancelled) setProfile(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [symbol, assetClass]);

  const cur = chart?.currency ?? currency;
  const money = (v: number) => `${formatPrice(v)} ${cur}`;
  const points = chart?.points ?? [];
  const showingRange = shown.endsWith(`|${range}`);

  // Der letzte Punkt des Verlaufs wird durch den aktuellen Kurs der App ersetzt, falls vorhanden
  const last = points.length > 0 ? points[points.length - 1].v : null;
  const current = price ?? chart?.price ?? last;
  const first = points.length > 0 ? points[0].v : null;
  const change = current !== null && first !== null ? current - first : null;
  const changePct = change !== null && first ? (change / first) * 100 : null;
  const up = (change ?? 0) >= 0;
  const color = up ? "#4ade80" : "#ff6b6b";

  const series = useMemo(() => {
    if (points.length === 0) return [];
    return points.map((p) => ({ t: p.t, v: p.v }));
  }, [points]);
  const reference = useMemo(
    () => (entry !== null && series.length > 1 ? [{ t: series[0].t, v: entry }, { t: series[series.length - 1].t, v: entry }] : []),
    [entry, series],
  );

  const values = points.map((p) => p.v);
  const facts: { label: string; value: string }[] = [];
  const add = (label: string, value: string | null | undefined) => value && facts.push({ label, value });
  if (values.length > 0) {
    add("Hoch im Zeitraum", money(Math.max(...values)));
    add("Tief im Zeitraum", money(Math.min(...values)));
  }
  if (chart?.dayLow != null && chart.dayHigh != null) add("Tagesspanne", `${formatPrice(chart.dayLow)} – ${formatPrice(chart.dayHigh)} ${cur}`);
  if (chart?.yearLow != null && chart.yearHigh != null) add("52 Wochen", `${formatPrice(chart.yearLow)} – ${formatPrice(chart.yearHigh)} ${cur}`);
  if (chart?.volume != null && chart.volume > 0) add("Handelsvolumen", formatCompact(chart.volume));
  add("Börse", profile?.exchange ?? chart?.exchange);
  add("Branche", profile?.industry);
  add("Land", profile?.country);
  if (profile?.marketCap) add("Börsenwert", `${formatCompact(profile.marketCap * 1e6)} ${cur}`);

  return (
    <section className="ai" aria-label="Kursverlauf">
      <header className="ai-head">
        <div className="ai-price">
          <strong>{current !== null ? money(current) : "–"}</strong>
          {change !== null && changePct !== null && (
            <span className={`ai-change ${up ? "tr-pos" : "tr-neg"}`}>
              {formatSigned(change)} ({formatPercent(changePct)})
              <em> · {range}</em>
            </span>
          )}
        </div>
        <div className="segmented">
          {ASSET_RANGES.map((r) => (
            <button key={r} type="button" className={range === r ? "active" : ""} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </header>

      <div className={`ai-chart${loading ? " loading" : ""}`}>
        {series.length > 1 && !error && showingRange ? (
          <ValueChart
            points={series}
            color={color}
            reference={reference}
            referenceLabel="Ø Einstieg"
            legend={false}
            format={money}
            axis={axisLabel}
            ariaLabel={`Kursverlauf ${symbol}`}
            markers={markers}
          />
        ) : (
          <div className="ai-empty">
            {error ? (
              <>
                <strong>Kein Kursverlauf verfügbar</strong>
                <span>{error}</span>
              </>
            ) : (
              <span>{loading ? "Kursverlauf wird geladen …" : "Keine Kurse für diesen Zeitraum."}</span>
            )}
          </div>
        )}
      </div>

      {facts.length > 0 && (
        <dl className="ai-facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
