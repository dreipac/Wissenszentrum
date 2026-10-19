import { invoke } from "@tauri-apps/api/core";
import type { AssetChart, AssetProfile, AssetRange, ChartPoint } from "../assetInfo";
import { inTauri } from "./runtime";

/** Kursverlauf und Kennzahlen eines Symbols. */
export function loadAssetChart(symbol: string, range: AssetRange): Promise<AssetChart> {
  return inTauri ? invoke("asset_chart", { symbol, range }) : previewChart(symbol, range);
}

/** Firmendaten eines Symbols; leer ohne API-Key. */
export function loadAssetProfile(symbol: string): Promise<AssetProfile> {
  return inTauri
    ? invoke("asset_profile", { symbol })
    : Promise.resolve({ name: null, industry: "Technologie", country: "US", exchange: "NASDAQ", marketCap: 2_800_000, website: null });
}

// Browser-Preview ohne Tauri: Der Kursanbieter lässt keine Abrufe aus dem Browser zu. Zum Ansehen der Oberfläche
// entsteht ein erfundener, aber stabiler Verlauf je Symbol und Zeitraum.
const SPAN_MS: Record<AssetRange, number> = { "1T": 864e5, "5T": 5 * 864e5, "1M": 30 * 864e5, "6M": 182 * 864e5, "1J": 365 * 864e5, "5J": 5 * 365 * 864e5 };

function seeded(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function previewChart(symbol: string, range: AssetRange): Promise<AssetChart> {
  const rnd = seeded([...symbol].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) + range.length * 977);
  const n = 120;
  const end = Date.now();
  const start = end - SPAN_MS[range];
  let v = 40 + rnd() * 160;
  const points: ChartPoint[] = [];
  for (let i = 0; i < n; i++) {
    v = Math.max(1, v * (1 + (rnd() - 0.48) * 0.03));
    points.push({ t: Math.round(start + ((end - start) * i) / (n - 1)), v: Math.round(v * 100) / 100 });
  }
  const values = points.map((p) => p.v);
  const last = points[points.length - 1].v;
  return new Promise((resolve) =>
    window.setTimeout(
      () =>
        resolve({
          points,
          currency: "USD",
          name: `${symbol} (Vorschau)`,
          exchange: "NasdaqGS",
          price: last,
          previousClose: points[0].v,
          dayHigh: Math.max(...values.slice(-20)),
          dayLow: Math.min(...values.slice(-20)),
          yearHigh: Math.max(...values),
          yearLow: Math.min(...values),
          volume: 3_400_000,
        }),
      250,
    ),
  );
}
