import { toDateStr } from "./dates";
import type { CashMovement, Sample, Snapshot } from "./trading";

export const RANGES = ["1T", "5T", "1M", "6M", "YTD", "1J", "Alles"] as const;
export type Range = (typeof RANGES)[number];

export interface SeriesPoint {
  /** Zeitpunkt in Millisekunden */
  t: number;
  /** Gesamtvermögen in CHF */
  v: number;
}

export interface Series {
  points: SeriesPoint[];
  /** Es gibt noch kaum Verlauf: die Linie wurde um einen Ausgangspunkt ergänzt */
  sparse: boolean;
  /** Eingezahltes Kapital (Einzahlungen minus Auszahlungen) als Stufenlinie über denselben Zeitraum */
  invested: SeriesPoint[];
  /** Seit wann Werte aufgezeichnet sind; davor kennt die App keine Kurse */
  recordedFrom: number | null;
}

/** Zeitpunkt einer Geldbewegung (lokale Zeit `YYYY-MM-DD HH:MM`). */
const movementTime = (m: CashMovement) => new Date(m.occurredAt.replace(" ", "T")).getTime();

/** Eingezahltes Kapital insgesamt. */
export const netDeposits = (movements: CashMovement[]) =>
  movements.reduce((sum, m) => sum + (m.kind === "deposit" ? m.amount : -m.amount), 0);

/** Stufenlinie des eingezahlten Kapitals von `from` bis `to`. Ohne Bewegungen leer. */
function investedSeries(movements: CashMovement[], from: number, to: number): SeriesPoint[] {
  if (movements.length === 0) return [];
  const sorted = [...movements].sort((a, b) => movementTime(a) - movementTime(b));
  let sum = 0;
  const points: SeriesPoint[] = [];
  let atStart = 0;
  for (const m of sorted) {
    const t = movementTime(m);
    sum += m.kind === "deposit" ? m.amount : -m.amount;
    if (t <= from) atStart = sum;
    else if (t < to) points.push({ t, v: sum });
  }
  return [{ t: from, v: atStart }, ...points, { t: to, v: sum }];
}

/** SQLite liefert UTC ohne Zeitzone. */
const parseUtc = (ts: string) => Date.parse(`${ts.replace(" ", "T")}Z`);

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Ende des Tages in lokaler Zeit: Der Tagesstand gilt zum Tagesabschluss. */
const dayEnd = (day: string) => new Date(`${day}T23:59:59`).getTime();

/** Beginn des Zeitraums in Millisekunden, null = alles. */
export function rangeStart(range: Range, now = new Date()): number | null {
  const d = new Date(now);
  switch (range) {
    case "1T":
      return startOfDay(now);
    case "5T":
      d.setDate(d.getDate() - 5);
      return d.getTime();
    case "1M":
      d.setMonth(d.getMonth() - 1);
      return d.getTime();
    case "6M":
      d.setMonth(d.getMonth() - 6);
      return d.getTime();
    case "YTD":
      return new Date(now.getFullYear(), 0, 1).getTime();
    case "1J":
      d.setFullYear(d.getFullYear() - 1);
      return d.getTime();
    default:
      return null;
  }
}

/**
 * Verlauf des Gesamtvermögens für einen Zeitraum. Der letzte Punkt ist immer der aktuelle Wert, die Linie bewegt
 * sich also mit jedem neuen Kurs. 1T und 5T nutzen die Zwischenstände, längere Zeiträume die Tagesstände.
 */
export function buildSeries(range: Range, snapshots: Snapshot[], samples: Sample[], total: number, movements: CashMovement[], now = new Date()): Series {
  const nowMs = now.getTime();
  const today = toDateStr(now);
  const start = rangeStart(range, now);
  const before = snapshots.filter((s) => s.day < today).sort((a, b) => a.day.localeCompare(b.day));
  const points: SeriesPoint[] = [];

  if (range === "1T" || range === "5T") {
    const sampled = samples
      .map((s) => ({ t: parseUtc(s.ts), v: s.valueChf }))
      .filter((p) => (start === null || p.t >= start) && p.t < nowMs)
      .sort((a, b) => a.t - b.t);
    if (range === "1T") {
      // Ausgangspunkt: der letzte Tagesstand vor heute, gesetzt auf Tagesbeginn
      const baseline = before[before.length - 1];
      if (baseline && start !== null) points.push({ t: start, v: baseline.valueChf });
    } else {
      // Tage ohne Zwischenstände mit dem Tagesstand füllen
      const firstSampleDay = sampled.length ? toDateStr(new Date(sampled[0].t)) : today;
      for (const s of before) {
        if (s.day < firstSampleDay && (start === null || dayEnd(s.day) >= start)) points.push({ t: dayEnd(s.day), v: s.valueChf });
      }
    }
    points.push(...sampled);
  } else {
    for (const s of before) {
      if (start === null || dayEnd(s.day) >= start) points.push({ t: dayEnd(s.day), v: s.valueChf });
    }
  }

  points.push({ t: nowMs, v: total });

  const recorded = [...snapshots.map((s) => new Date(`${s.day}T00:00:00`).getTime()), ...samples.map((s) => parseUtc(s.ts))];
  const recordedFrom = recorded.length ? Math.min(...recorded) : null;

  if (points.length < 2) {
    const from = Math.max(start ?? nowMs - 3_600_000, nowMs - 3_600_000);
    const filled = [{ t: from, v: total }, ...points];
    return { points: filled, sparse: true, invested: investedSeries(movements, from, nowMs), recordedFrom };
  }
  return { points, sparse: false, invested: investedSeries(movements, points[0].t, nowMs), recordedFrom };
}
