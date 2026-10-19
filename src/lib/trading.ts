// Typen des Trading-Bereichs (spiegeln das Rust-Backend) und kleine Hilfen.

export type TradeAssetClass = "aktie" | "krypto";
export type AssetClass = TradeAssetClass | "edelmetall";
export type TradeStatus = "order" | "open" | "closed";
export type MetalKind = "gold" | "silber" | "platin" | "palladium";
export type MetalUnit = "g" | "kg" | "oz";

export interface Execution {
  id: number;
  tradeId: number;
  kind: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  /** Lokale Zeit YYYY-MM-DD HH:MM */
  executedAt: string;
  realizedChf: number;
}

export interface Trade {
  id: number;
  symbol: string;
  name: string;
  assetClass: TradeAssetClass;
  currency: string;
  /** CHF je 1 Einheit der Positionswährung */
  fxRate: number;
  status: TradeStatus;
  stopLoss: number | null;
  target: number | null;
  thesis: string;
  closeNote: string;
  plannedQuantity: number | null;
  plannedPrice: number | null;
  validUntil: string | null;
  createdAt: string;
  closedAt: string | null;
  executions: Execution[];
  /** Gehaltene Menge */
  quantity: number;
  /** Durchschnittlicher Einstieg ohne Gebühren */
  avgPrice: number;
  /** Gebundenes Kapital der offenen Menge (CHF, inkl. Gebühren) */
  costChf: number;
  realizedChf: number;
}

export interface CashMovement {
  id: number;
  kind: "deposit" | "withdrawal";
  amount: number;
  note: string;
  occurredAt: string;
}

export interface Metal {
  id: number;
  name: string;
  metal: MetalKind;
  quantity: number;
  unit: MetalUnit;
  costChf: number | null;
  spotChfPerOz: number | null;
  /** UTC, wie die Zeitstempel der Notizen */
  spotUpdatedAt: string | null;
  note: string;
}

export interface Quote {
  symbol: string;
  price: number;
  /** UTC */
  updatedAt: string;
}

export interface Snapshot {
  /** YYYY-MM-DD */
  day: string;
  valueChf: number;
}

/** Zwischenstand des Gesamtvermögens im Tagesverlauf. */
export interface Sample {
  /** UTC, `YYYY-MM-DD HH:MM:SS` */
  ts: string;
  valueChf: number;
}

export interface TradingState {
  trades: Trade[];
  movements: CashMovement[];
  cashChf: number;
  metals: Metal[];
  quotes: Quote[];
  snapshots: Snapshot[];
  samples: Sample[];
  hasApiKey: boolean;
}

export interface NewTrade {
  kind: "position" | "order";
  symbol: string;
  name: string;
  assetClass: TradeAssetClass;
  currency: string;
  fxRate: number;
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
  stopLoss: number | null;
  target: number | null;
  thesis: string;
  validUntil: string | null;
}

export interface NewExecution {
  kind: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
  fxRate: number | null;
  closeNote: string;
}

export interface TradeMeta {
  name: string;
  stopLoss: number | null;
  target: number | null;
  thesis: string;
  fxRate: number;
  validUntil: string | null;
}

export interface MetalInput {
  name: string;
  metal: MetalKind;
  quantity: number;
  unit: MetalUnit;
  costChf: number | null;
  spotChfPerOz: number | null;
  note: string;
}

export interface RefreshResult {
  updated: number;
  failed: string[];
}

export interface SymbolMatch {
  symbol: string;
  description: string;
}

export const assetClassLabel: Record<AssetClass, string> = { aktie: "Aktie", krypto: "Krypto", edelmetall: "Edelmetall" };
export const metalLabel: Record<MetalKind, string> = { gold: "Gold", silber: "Silber", platin: "Platin", palladium: "Palladium" };
export const unitLabel: Record<MetalUnit, string> = { g: "g", kg: "kg", oz: "oz (Feinunze)" };

export const CURRENCIES = ["CHF", "USD", "EUR", "GBP", "USDT"];

/** Gramm je Feinunze (Troy Ounce) */
export const TROY_OUNCE_GRAMS = 31.1034768;

export const quantityInOz = (quantity: number, unit: MetalUnit) =>
  unit === "g" ? quantity / TROY_OUNCE_GRAMS : unit === "kg" ? (quantity * 1000) / TROY_OUNCE_GRAMS : quantity;

/** Menge ohne überflüssige Nullen (bis 8 Nachkommastellen), mit Tausendertrennung. */
export const formatQuantity = (value: number) =>
  parseFloat(value.toFixed(8)).toLocaleString("de-CH", { maximumFractionDigits: 8 });

/** Preis mit passender Genauigkeit: grosse Preise ohne, kleine mit Nachkommastellen. */
export const formatPrice = (value: number) =>
  value.toLocaleString("de-CH", { minimumFractionDigits: value >= 1000 ? 0 : 2, maximumFractionDigits: value >= 1000 ? 2 : 4 });

/** Anzeige einer Menge mit Einheit (Stk. bzw. Kürzel der Krypto-Währung). */
export const quantityWithUnit = (value: number, assetClass: TradeAssetClass, symbol: string) =>
  assetClass === "aktie" ? `${formatQuantity(value)} Stk.` : `${formatQuantity(value)} ${symbol.split(/[:\-/]/).pop()?.replace(/(USDT|USD|EUR|CHF)$/, "") || symbol}`;
