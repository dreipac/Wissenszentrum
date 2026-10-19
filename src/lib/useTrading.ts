import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadTradingState, refreshQuotes, saveSample, saveSnapshot } from "./api/trading";
import { onChange } from "./changes";
import { toDateStr } from "./dates";
import { buildModel } from "./tradingModel";
import type { Snapshot, TradingState } from "./trading";

const EMPTY: TradingState = { trades: [], movements: [], cashChf: 0, metals: [], quotes: [], snapshots: [], samples: [], hasApiKey: false };

export type QuoteStatus = { kind: "idle" } | { kind: "loading" } | { kind: "ok"; updated: number; failed: string[] } | { kind: "error"; message: string };

/** Finnhub erlaubt im kostenlosen Tarif 60 Abfragen pro Minute */
const MIN_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 300_000;
/** Kurse, die gerade erst geholt wurden, nicht beim Wechsel der Ansicht sofort noch einmal holen */
const FRESH_MS = 10_000;

let lastRefreshAt = 0;

export interface LiveInfo {
  /** Es laufen gerade regelmäßige Abfragen (Key vorhanden, etwas zu bewerten) */
  active: boolean;
  intervalSec: number;
  /** Zeitpunkt der letzten erfolgreichen Abfrage in Millisekunden */
  lastAt: number | null;
  error: string | null;
}

/**
 * Trading-Daten samt Bewertung. Lädt bei Änderungen automatisch neu und hält Gesamtwert, Tagesstand und
 * Tagesverlauf fest. Mit `live` holt die Ansicht regelmäßig neue Kurse, solange sie offen und sichtbar ist.
 */
export function useTrading(options: { live?: boolean } = {}) {
  const [state, setState] = useState<TradingState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>({ kind: "idle" });
  const [extraSnapshots, setExtraSnapshots] = useState<Snapshot[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveAt, setLiveAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await loadTradingState());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return onChange("trading", () => void load());
  }, [load]);

  const model = useMemo(() => buildModel(state), [state]);

  // Tageswert und Zwischenstand: bei jeder Änderung des Gesamtwerts, nicht bei leerem Depot
  const lastSaved = useRef<string>("");
  useEffect(() => {
    if (!loaded) return;
    const hasData = state.movements.length > 0 || state.trades.length > 0 || state.metals.length > 0;
    if (!hasData) return;
    const day = toDateStr(new Date());
    const value = Math.round(model.total * 100) / 100;
    const key = `${day}:${value}`;
    if (key === lastSaved.current) return;
    lastSaved.current = key;
    void saveSnapshot(day, value)
      .then(() => setExtraSnapshots((list) => [...list.filter((s) => s.day !== day), { day, valueChf: value }]))
      .catch(() => undefined);
    void saveSample(value).catch(() => undefined);
  }, [loaded, model.total, state.movements.length, state.trades.length, state.metals.length]);

  // Gespeicherte Schnappschüsse plus der gerade geschriebene
  const snapshots = useMemo(() => {
    const byDay = new Map(state.snapshots.map((s) => [s.day, s]));
    for (const s of extraSnapshots) byDay.set(s.day, s);
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [state.snapshots, extraSnapshots]);

  const updateQuotes = useCallback(async () => {
    setQuoteStatus({ kind: "loading" });
    try {
      const result = await refreshQuotes();
      lastRefreshAt = Date.now();
      setQuoteStatus({ kind: "ok", updated: result.updated, failed: result.failed });
    } catch (e) {
      setQuoteStatus({ kind: "error", message: String(e) });
    }
  }, []);

  // Live-Kurse: gestaffelte Abfragen im Takt, der zur Zahl der Symbole passt
  const trackedSymbols = useMemo(() => new Set(state.trades.filter((t) => t.status !== "closed").map((t) => t.symbol)).size, [state.trades]);
  const intervalMs = Math.max(MIN_INTERVAL_MS, Math.ceil(trackedSymbols * 1.3) * 1000);
  const active = options.live === true && state.hasApiKey && trackedSymbols > 0;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let failures = 0;
    let timer: number | undefined;

    const run = async () => {
      if (stopped) return;
      if (!document.hidden && Date.now() - lastRefreshAt >= FRESH_MS) {
        try {
          await refreshQuotes();
          lastRefreshAt = Date.now();
          failures = 0;
          if (!stopped) {
            setLiveAt(lastRefreshAt);
            setLiveError(null);
          }
        } catch (e) {
          failures += 1;
          if (!stopped) setLiveError(String(e));
        }
      }
      if (stopped) return;
      // Nach Fehlern (Limit, kein Netz) länger warten
      const wait = Math.min(intervalMs * 2 ** Math.min(failures, 4), MAX_BACKOFF_MS);
      timer = window.setTimeout(() => void run(), wait);
    };

    const onVisible = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      void run();
    };

    void run();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, intervalMs]);

  const live: LiveInfo = { active, intervalSec: Math.round(intervalMs / 1000), lastAt: liveAt, error: liveError };

  return { state, model, snapshots, samples: state.samples, loaded, error, quoteStatus, updateQuotes, live };
}
