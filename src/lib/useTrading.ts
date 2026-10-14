import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadTradingState, refreshQuotes, saveSnapshot } from "./api/trading";
import { onChange } from "./changes";
import { toDateStr } from "./dates";
import { buildModel } from "./tradingModel";
import type { Snapshot, TradingState } from "./trading";

const EMPTY: TradingState = { trades: [], movements: [], cashChf: 0, metals: [], quotes: [], snapshots: [], hasApiKey: false };

export type QuoteStatus = { kind: "idle" } | { kind: "loading" } | { kind: "ok"; updated: number; failed: string[] } | { kind: "error"; message: string };

/** Trading-Daten samt Bewertung. Lädt bei Änderungen automatisch neu und hält täglich den Gesamtwert fest. */
export function useTrading() {
  const [state, setState] = useState<TradingState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>({ kind: "idle" });
  const [extraSnapshots, setExtraSnapshots] = useState<Snapshot[]>([]);

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

  // Tageswert für den Verlauf: einmal je Änderung des Gesamtwerts, nicht bei leerem Depot
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
      setQuoteStatus({ kind: "ok", updated: result.updated, failed: result.failed });
    } catch (e) {
      setQuoteStatus({ kind: "error", message: String(e) });
    }
  }, []);

  return { state, model, snapshots, loaded, error, quoteStatus, updateQuotes };
}
