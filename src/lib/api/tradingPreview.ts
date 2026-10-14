// Nur für das Browser-Preview ohne Tauri: In-Memory-Nachbau des Trading-Backends (gleiche Rechenregeln wie trading.rs).
// In der echten App wird dieser Code nie benutzt.
import type {
  CashMovement,
  Execution,
  Metal,
  MetalInput,
  NewExecution,
  NewTrade,
  Quote,
  RefreshResult,
  Snapshot,
  SymbolMatch,
  Trade,
  TradeMeta,
  TradingState,
} from "../trading";

const EPS = 1e-9;
let nextId = 1;
const id = () => nextId++;

let trades: Trade[] = [];
let movements: CashMovement[] = [];
let metals: Metal[] = [];
let quotes: Quote[] = [];
let snapshots: Snapshot[] = [];
let apiKey = "";

const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

function positive(value: number, what: string) {
  if (!Number.isFinite(value) || value <= 0) throw `${what} muss größer als 0 sein.`;
}

function derive(t: Trade) {
  let qty = 0;
  let avgPrice = 0;
  let avgCost = 0;
  let realized = 0;
  const sorted = [...t.executions].sort((a, b) => a.executedAt.localeCompare(b.executedAt) || a.id - b.id);
  for (const e of sorted) {
    if (e.kind === "buy") {
      const q = qty + e.quantity;
      avgPrice = (avgPrice * qty + e.price * e.quantity) / q;
      avgCost = (avgCost * qty + e.price * e.quantity + e.fee) / q;
      qty = q;
      e.realizedChf = 0;
    } else {
      const gain = (e.price * e.quantity - e.fee - avgCost * e.quantity) * t.fxRate;
      e.realizedChf = gain;
      realized += gain;
      qty -= e.quantity;
      if (qty < EPS) qty = 0;
    }
  }
  t.executions = sorted;
  t.quantity = qty;
  t.avgPrice = avgPrice;
  t.costChf = qty * avgCost * t.fxRate;
  t.realizedChf = realized;
  return t;
}

function cash(): number {
  const m = movements.reduce((s, x) => s + (x.kind === "deposit" ? x.amount : -x.amount), 0);
  const e = trades.reduce(
    (s, t) =>
      s + t.executions.reduce((a, x) => a + (x.kind === "buy" ? -(x.quantity * x.price + x.fee) : x.quantity * x.price - x.fee) * t.fxRate, 0),
    0,
  );
  return m + e;
}

function ensureCash(cost: number) {
  const c = cash();
  if (cost > c + 0.005) throw `Das Guthaben reicht nicht: benötigt ${cost.toFixed(2)} CHF, verfügbar ${c.toFixed(2)} CHF. Lade zuerst Guthaben auf.`;
}

const find = (tradeId: number) => {
  const t = trades.find((x) => x.id === tradeId);
  if (!t) throw "Position nicht gefunden.";
  return t;
};

const fxFor = (currency: string, rate: number) => {
  const c = currency.trim().toUpperCase();
  if (c === "CHF") return { currency: c, fx: 1 };
  positive(rate, "Der Wechselkurs");
  return { currency: c, fx: rate };
};

function checkExecution(e: NewExecution) {
  positive(e.quantity, "Die Menge");
  positive(e.price, "Der Preis");
  if (e.fee < 0) throw "Die Gebühr darf nicht negativ sein.";
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(e.executedAt)) throw "Ungültiger Zeitpunkt (erwartet: YYYY-MM-DD HH:MM).";
}

function execution(tradeId: number, kind: "buy" | "sell", e: NewExecution): Execution {
  return { id: id(), tradeId, kind, quantity: e.quantity, price: e.price, fee: e.fee, executedAt: e.executedAt, realizedChf: 0 };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export const tradingPreview = {
  async state(): Promise<TradingState> {
    return clone({
      trades: [...trades].sort((a, b) => b.id - a.id),
      movements: [...movements].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id),
      cashChf: cash(),
      metals: [...metals].sort((a, b) => b.id - a.id),
      quotes,
      snapshots: [...snapshots].sort((a, b) => a.day.localeCompare(b.day)),
      hasApiKey: apiKey.trim() !== "",
    });
  },

  async createTrade(input: NewTrade): Promise<Trade> {
    const symbol = input.symbol.trim().toUpperCase();
    if (!symbol) throw "Das Symbol darf nicht leer sein.";
    const { currency, fx } = fxFor(input.currency, input.fxRate);
    positive(input.quantity, "Die Menge");
    positive(input.price, "Der Preis");
    const base = {
      id: id(),
      symbol,
      name: input.name.trim() || symbol,
      assetClass: input.assetClass,
      currency,
      fxRate: fx,
      stopLoss: input.stopLoss,
      target: input.target,
      thesis: input.thesis,
      closeNote: "",
      createdAt: utcNow(),
      closedAt: null,
      executions: [] as Execution[],
      quantity: 0,
      avgPrice: 0,
      costChf: 0,
      realizedChf: 0,
    };
    if (input.kind === "position") {
      const e: NewExecution = { kind: "buy", quantity: input.quantity, price: input.price, fee: input.fee, executedAt: input.executedAt, fxRate: null, closeNote: "" };
      checkExecution(e);
      ensureCash((input.quantity * input.price + input.fee) * fx);
      const t: Trade = { ...base, status: "open", plannedQuantity: null, plannedPrice: null, validUntil: null };
      t.executions.push(execution(t.id, "buy", e));
      trades.push(derive(t));
      return clone(t);
    }
    const t: Trade = { ...base, status: "order", plannedQuantity: input.quantity, plannedPrice: input.price, validUntil: input.validUntil || null };
    trades.push(t);
    return clone(t);
  },

  async executeOrder(tradeId: number, e: NewExecution): Promise<Trade> {
    const t = find(tradeId);
    if (t.status !== "order") throw "Nur Orders können ausgeführt werden.";
    checkExecution(e);
    const fx = e.fxRate !== null && t.currency !== "CHF" ? e.fxRate : t.fxRate;
    positive(fx, "Der Wechselkurs");
    ensureCash((e.quantity * e.price + e.fee) * fx);
    t.fxRate = fx;
    t.executions.push(execution(t.id, "buy", e));
    t.status = "open";
    return clone(derive(t));
  },

  async addExecution(tradeId: number, e: NewExecution): Promise<Trade> {
    const t = find(tradeId);
    if (t.status !== "open") throw "Nur offene Positionen können angepasst werden.";
    checkExecution(e);
    if (e.kind === "buy") {
      ensureCash((e.quantity * e.price + e.fee) * t.fxRate);
      t.executions.push(execution(t.id, "buy", e));
    } else {
      if (e.quantity > t.quantity + EPS) throw `Du hältst nur ${t.quantity} Stück, kannst also nicht ${e.quantity} verkaufen.`;
      t.executions.push(execution(t.id, "sell", e));
      if (t.quantity - e.quantity < EPS) {
        t.status = "closed";
        t.closedAt = e.executedAt;
        t.closeNote = e.closeNote.trim();
      }
    }
    return clone(derive(t));
  },

  async updateTrade(tradeId: number, m: TradeMeta): Promise<Trade> {
    const t = find(tradeId);
    if (t.currency !== "CHF") {
      positive(m.fxRate, "Der Wechselkurs");
      t.fxRate = m.fxRate;
    }
    t.name = m.name.trim() || t.symbol;
    t.stopLoss = m.stopLoss;
    t.target = m.target;
    t.thesis = m.thesis;
    if (t.status === "order") t.validUntil = m.validUntil || null;
    return clone(derive(t));
  },

  async deleteTrade(tradeId: number): Promise<void> {
    find(tradeId);
    trades = trades.filter((t) => t.id !== tradeId);
  },

  async addCashMovement(kind: "deposit" | "withdrawal", amount: number, note: string, occurredAt: string): Promise<void> {
    positive(amount, "Der Betrag");
    if (kind === "withdrawal") ensureCash(amount);
    movements.push({ id: id(), kind, amount, note: note.trim(), occurredAt });
  },

  async deleteCashMovement(movementId: number): Promise<void> {
    const m = movements.find((x) => x.id === movementId);
    if (!m) throw "Kapitalbewegung nicht gefunden.";
    if (m.kind === "deposit" && cash() - m.amount < -0.005) throw "Nicht möglich: Das Guthaben würde dadurch negativ.";
    movements = movements.filter((x) => x.id !== movementId);
  },

  async createMetal(input: MetalInput): Promise<void> {
    if (!input.name.trim()) throw "Die Bezeichnung darf nicht leer sein.";
    positive(input.quantity, "Die Menge");
    metals.push({ ...input, id: id(), name: input.name.trim(), spotUpdatedAt: input.spotChfPerOz === null ? null : utcNow() });
  },

  async updateMetal(metalId: number, input: MetalInput): Promise<void> {
    const m = metals.find((x) => x.id === metalId);
    if (!m) throw "Edelmetall nicht gefunden.";
    if (!input.name.trim()) throw "Die Bezeichnung darf nicht leer sein.";
    positive(input.quantity, "Die Menge");
    if (m.spotChfPerOz !== input.spotChfPerOz) m.spotUpdatedAt = input.spotChfPerOz === null ? null : utcNow();
    Object.assign(m, input, { name: input.name.trim() });
  },

  async deleteMetal(metalId: number): Promise<void> {
    if (!metals.some((x) => x.id === metalId)) throw "Edelmetall nicht gefunden.";
    metals = metals.filter((x) => x.id !== metalId);
  },

  async setQuote(symbol: string, price: number): Promise<void> {
    positive(price, "Der Kurs");
    const s = symbol.trim().toUpperCase();
    quotes = [...quotes.filter((q) => q.symbol !== s), { symbol: s, price, updatedAt: utcNow() }];
  },

  async saveSnapshot(day: string, valueChf: number): Promise<void> {
    snapshots = [...snapshots.filter((s) => s.day !== day), { day, valueChf }];
  },

  async getApiKey(): Promise<string> {
    return apiKey;
  },

  async saveApiKey(key: string): Promise<void> {
    if (key.trim() && key.trim().length < 6) throw "Ungültiger API-Key.";
    apiKey = key.trim();
  },

  /** Im Preview gibt es kein Netz: vorhandene Kurse bewegen sich leicht, damit die Anzeige testbar ist. */
  async refreshQuotes(): Promise<RefreshResult> {
    if (!apiKey) throw "Kein Finnhub-API-Key hinterlegt. Trage ihn unter Einstellungen ein.";
    const symbols = [...new Set(trades.filter((t) => t.status !== "closed").map((t) => t.symbol))];
    for (const s of symbols) {
      const t = trades.find((x) => x.symbol === s)!;
      const last = quotes.find((q) => q.symbol === s)?.price ?? t.avgPrice ?? t.plannedPrice ?? 100;
      await this.setQuote(s, Math.round(last * 1.02 * 100) / 100);
    }
    return { updated: symbols.length, failed: [] };
  },

  async searchSymbols(query: string): Promise<SymbolMatch[]> {
    return apiKey && query.trim() ? [{ symbol: query.trim().toUpperCase(), description: "Vorschlag (Preview)" }] : [];
  },
};
