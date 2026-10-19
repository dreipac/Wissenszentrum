export const ASSET_RANGES = ["1T", "5T", "1M", "6M", "1J", "5J"] as const;
export type AssetRange = (typeof ASSET_RANGES)[number];

export interface ChartPoint {
  /** Zeitpunkt in Millisekunden */
  t: number;
  /** Kurs in Handelswährung */
  v: number;
}

/** Kursverlauf eines Symbols samt Kennzahlen des Kursanbieters. */
export interface AssetChart {
  points: ChartPoint[];
  currency: string | null;
  name: string | null;
  exchange: string | null;
  price: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  volume: number | null;
}

/** Firmendaten (nur Aktien, nur mit Finnhub-Key). */
export interface AssetProfile {
  name: string | null;
  industry: string | null;
  country: string | null;
  exchange: string | null;
  /** Börsenwert in Millionen der Handelswährung */
  marketCap: number | null;
  website: string | null;
}

/** Kompakte Zahl: 2.5 Mio., 1.2 Mrd. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const fmt = (n: number, unit: string) => `${n.toLocaleString("de-CH", { maximumFractionDigits: 2 })} ${unit}`;
  if (abs >= 1e12) return fmt(value / 1e12, "Bio.");
  if (abs >= 1e9) return fmt(value / 1e9, "Mrd.");
  if (abs >= 1e6) return fmt(value / 1e6, "Mio.");
  if (abs >= 1e3) return fmt(value / 1e3, "Tsd.");
  return value.toLocaleString("de-CH", { maximumFractionDigits: 0 });
}
