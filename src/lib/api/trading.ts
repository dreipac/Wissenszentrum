import { invoke } from "@tauri-apps/api/core";
import { notifyChange } from "../changes";
import type {
  MetalInput,
  NewExecution,
  NewTrade,
  RefreshResult,
  SymbolMatch,
  Trade,
  TradeMeta,
  TradingState,
} from "../trading";
import { inTauri } from "./runtime";
import { tradingPreview } from "./tradingPreview";

/** Nach jeder Änderung laden alle Trading-Ansichten neu. */
async function changed<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  notifyChange("trading");
  return value;
}

export const loadTradingState = (): Promise<TradingState> => (inTauri ? invoke("trading_state") : tradingPreview.state());

export const createTrade = (input: NewTrade): Promise<Trade> =>
  changed(inTauri ? invoke("create_trade", { input }) : tradingPreview.createTrade(input));

/** Führt eine Order aus: sie wird zur offenen Position. */
export const executeOrder = (id: number, input: NewExecution): Promise<Trade> =>
  changed(inTauri ? invoke("execute_order", { id, input }) : tradingPreview.executeOrder(id, input));

/** Nachkauf oder (Teil-)Verkauf; ist nichts mehr übrig, wird die Position geschlossen. */
export const addExecution = (id: number, input: NewExecution): Promise<Trade> =>
  changed(inTauri ? invoke("add_execution", { id, input }) : tradingPreview.addExecution(id, input));

export const updateTrade = (id: number, input: TradeMeta): Promise<Trade> =>
  changed(inTauri ? invoke("update_trade", { id, input }) : tradingPreview.updateTrade(id, input));

export const deleteTrade = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_trade", { id }) : tradingPreview.deleteTrade(id));

export const addCashMovement = (kind: "deposit" | "withdrawal", amount: number, note: string, occurredAt: string): Promise<void> =>
  changed(inTauri ? invoke("add_cash_movement", { kind, amount, note, occurredAt }) : tradingPreview.addCashMovement(kind, amount, note, occurredAt));

export const deleteCashMovement = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_cash_movement", { id }) : tradingPreview.deleteCashMovement(id));

export const createMetal = (input: MetalInput): Promise<void> =>
  changed(inTauri ? invoke("create_metal", { input }) : tradingPreview.createMetal(input));

export const updateMetal = (id: number, input: MetalInput): Promise<void> =>
  changed(inTauri ? invoke("update_metal", { id, input }) : tradingPreview.updateMetal(id, input));

export const deleteMetal = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_metal", { id }) : tradingPreview.deleteMetal(id));

/** Kurs von Hand eintragen (z. B. ohne API-Key). */
export const setQuote = (symbol: string, price: number): Promise<void> =>
  changed(inTauri ? invoke("set_quote", { symbol, price }) : tradingPreview.setQuote(symbol, price));

/** Hält den Gesamtwert eines Tages fest (für den Verlauf). Löst bewusst kein Neuladen aus. */
export const saveSnapshot = (day: string, valueChf: number): Promise<void> =>
  inTauri ? invoke("save_snapshot", { day, valueChf }) : tradingPreview.saveSnapshot(day, valueChf);

/** Hält den Gesamtwert für den Tagesverlauf fest (das Backend lässt Unverändertes aus). Löst kein Neuladen aus. */
export const saveSample = (valueChf: number): Promise<void> =>
  inTauri ? invoke("save_sample", { valueChf }) : tradingPreview.saveSample(valueChf);

export const getApiKey = (): Promise<string> => (inTauri ? invoke("get_api_key") : tradingPreview.getApiKey());

/** Prüft den Key mit einer Testabfrage und speichert ihn (leer = entfernen). */
export const saveApiKey = (apiKey: string): Promise<void> =>
  changed(inTauri ? invoke("save_api_key", { apiKey }) : tradingPreview.saveApiKey(apiKey));

/** Holt aktuelle Kurse aller offenen Positionen und Orders über Finnhub. */
export const refreshQuotes = (): Promise<RefreshResult> =>
  changed(inTauri ? invoke("refresh_quotes") : tradingPreview.refreshQuotes());

export const searchSymbols = (query: string): Promise<SymbolMatch[]> =>
  inTauri ? invoke("search_symbols", { query }) : tradingPreview.searchSymbols(query);
