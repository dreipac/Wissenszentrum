import { formatPrice, formatQuantity, quantityInOz, quantityWithUnit, type AssetClass, type Metal, type Trade, type TradingState } from "./trading";

/** Eine offene Position mit Bewertung. */
export interface PositionRow {
  trade: Trade;
  /** Aktueller Kurs in Positionswährung; ohne gespeicherten Kurs gilt der Einstand */
  price: number;
  hasQuote: boolean;
  valueChf: number;
  pnlChf: number;
  pnlPct: number;
}

/** Eine Zeile der Asset-Sicht: zusammengefasste Position (je Symbol) oder ein Edelmetall. */
export interface HoldingRow {
  id: string;
  name: string;
  tag: string;
  assetClass: AssetClass;
  amount: string;
  unitPrice: string;
  valueChf: number;
  pnlPct: number | null;
  metal?: Metal;
  /** Wert ohne aktuellen Kurs bzw. Spotpreis geschätzt */
  estimated: boolean;
  /** Nur Aktien und Krypto: Symbol, Währung, durchschnittlicher Einstieg, aktueller Kurs (falls vorhanden), offene Positionen */
  symbol?: string;
  currency?: string;
  avgPrice?: number | null;
  price?: number | null;
  tradeIds?: number[];
}

export interface ActivityRow {
  id: string;
  kind: "buy" | "sell" | "deposit" | "withdrawal";
  title: string;
  detail: string;
  /** Lokale Zeit YYYY-MM-DD HH:MM */
  at: string;
}

export interface TradingModel {
  cash: number;
  open: PositionRow[];
  closed: Trade[];
  orders: Trade[];
  holdings: HoldingRow[];
  positionsValue: number;
  metalsValue: number;
  total: number;
  unrealized: number;
  realizedYtd: number;
  /** Ergebnis aller Verkäufe seit Beginn */
  realizedTotal: number;
  activity: ActivityRow[];
  /** Anteile für die Verteilung (CHF) */
  allocation: { cash: number; aktie: number; krypto: number; edelmetall: number };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function metalValue(m: Metal): { value: number; estimated: boolean } {
  if (m.spotChfPerOz !== null) return { value: quantityInOz(m.quantity, m.unit) * m.spotChfPerOz, estimated: false };
  return { value: m.costChf ?? 0, estimated: true };
}

export function buildModel(state: TradingState, now = new Date()): TradingModel {
  const quotes = new Map(state.quotes.map((q) => [q.symbol, q.price]));

  const open: PositionRow[] = state.trades
    .filter((t) => t.status === "open")
    .map((trade) => {
      const quote = quotes.get(trade.symbol);
      const price = quote ?? trade.avgPrice;
      const valueChf = trade.quantity * price * trade.fxRate;
      const pnlChf = valueChf - trade.costChf;
      return { trade, price, hasQuote: quote !== undefined, valueChf, pnlChf, pnlPct: trade.costChf > 0 ? (pnlChf / trade.costChf) * 100 : 0 };
    });

  const closed = state.trades.filter((t) => t.status === "closed");
  const orders = state.trades.filter((t) => t.status === "order");

  // Asset-Sicht: offene Positionen je Symbol zusammenfassen, dazu die Edelmetalle
  const bySymbol = new Map<string, PositionRow[]>();
  for (const row of open) {
    const key = `${row.trade.assetClass}:${row.trade.symbol}`;
    bySymbol.set(key, [...(bySymbol.get(key) ?? []), row]);
  }
  const positionHoldings: HoldingRow[] = [...bySymbol.entries()].map(([key, rows]) => {
    const first = rows[0].trade;
    const quantity = sum(rows.map((r) => r.trade.quantity));
    const valueChf = sum(rows.map((r) => r.valueChf));
    const cost = sum(rows.map((r) => r.trade.costChf));
    return {
      id: key,
      name: first.name,
      tag: first.symbol,
      assetClass: first.assetClass,
      amount: quantityWithUnit(quantity, first.assetClass, first.symbol),
      unitPrice: `${formatPrice(rows[0].price)} ${first.currency}`,
      valueChf,
      pnlPct: cost > 0 ? ((valueChf - cost) / cost) * 100 : null,
      estimated: rows.some((r) => !r.hasQuote),
      symbol: first.symbol,
      currency: first.currency,
      avgPrice: quantity > 0 ? sum(rows.map((r) => r.trade.avgPrice * r.trade.quantity)) / quantity : null,
      price: rows[0].hasQuote ? rows[0].price : null,
      tradeIds: rows.map((r) => r.trade.id),
    };
  });
  const metalHoldings: HoldingRow[] = state.metals.map((m) => {
    const { value, estimated } = metalValue(m);
    return {
      id: `metal:${m.id}`,
      name: m.name,
      tag: m.metal === "gold" ? "XAU" : m.metal === "silber" ? "XAG" : m.metal === "platin" ? "XPT" : "XPD",
      assetClass: "edelmetall",
      amount: `${formatQuantity(m.quantity)} ${m.unit}`,
      unitPrice: m.spotChfPerOz !== null ? `${formatPrice(m.spotChfPerOz)} CHF / oz` : "kein Spotpreis",
      valueChf: value,
      pnlPct: m.costChf && m.spotChfPerOz !== null ? ((value - m.costChf) / m.costChf) * 100 : null,
      metal: m,
      estimated,
    };
  });
  const holdings = [...positionHoldings, ...metalHoldings].sort((a, b) => b.valueChf - a.valueChf);

  const positionsValue = sum(open.map((r) => r.valueChf));
  const metalsValue = sum(metalHoldings.map((h) => h.valueChf));
  const year = String(now.getFullYear());
  const realizedYtd = sum(
    state.trades.flatMap((t) => t.executions).filter((e) => e.kind === "sell" && e.executedAt.startsWith(year)).map((e) => e.realizedChf),
  );

  const realizedTotal = sum(state.trades.flatMap((t) => t.executions).filter((e) => e.kind === "sell").map((e) => e.realizedChf));

  const byClass = (c: "aktie" | "krypto") => sum(open.filter((r) => r.trade.assetClass === c).map((r) => r.valueChf));

  const activity: ActivityRow[] = [
    ...state.trades.flatMap((t) =>
      t.executions.map<ActivityRow>((e) => ({
        id: `e${e.id}`,
        kind: e.kind,
        title: `${e.kind === "buy" ? "Kauf" : "Verkauf"} ${t.symbol}`,
        detail: `${quantityWithUnit(e.quantity, t.assetClass, t.symbol)} zu ${formatPrice(e.price)} ${t.currency}${
          e.kind === "sell" ? ` · ${e.realizedChf >= 0 ? "+" : "−"}${Math.abs(e.realizedChf).toFixed(2)} CHF` : ""
        }`,
        at: e.executedAt,
      })),
    ),
    ...state.movements.map<ActivityRow>((m) => ({
      id: `m${m.id}`,
      kind: m.kind,
      title: m.kind === "deposit" ? "Einzahlung" : "Auszahlung",
      detail: `${m.kind === "deposit" ? "+" : "−"}${m.amount.toFixed(2)} CHF${m.note ? ` · ${m.note}` : ""}`,
      at: m.occurredAt,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return {
    cash: state.cashChf,
    open,
    closed,
    orders,
    holdings,
    positionsValue,
    metalsValue,
    total: state.cashChf + positionsValue + metalsValue,
    unrealized: sum(open.map((r) => r.pnlChf)),
    realizedYtd,
    realizedTotal,
    activity,
    allocation: { cash: Math.max(state.cashChf, 0), aktie: byClass("aktie"), krypto: byClass("krypto"), edelmetall: metalsValue },
  };
}
