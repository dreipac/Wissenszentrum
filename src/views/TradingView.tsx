import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useOpenTarget } from "../lib/openTarget";
import {
  ArrowDownRight,
  ArrowUpRight,
  Bitcoin,
  Briefcase,
  Building2,
  Coins,
  Gem,
  LineChart,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { AssetModal } from "../components/trading/AssetModal";
import { JournalPage } from "../components/trading/JournalPage";
import { CashModal } from "../components/trading/CashModal";
import { Donut } from "../components/trading/Donut";
import { MetalModal } from "../components/trading/MetalModal";
import { PositionModal } from "../components/trading/PositionModal";
import { TradeModal } from "../components/trading/TradeModal";
import { ValueChart } from "../components/trading/ValueChart";
import { formatLocalWhen } from "../lib/dates";
import { useDialogs } from "../lib/dialogs";
import { formatMoney, formatPercent, formatSigned } from "../lib/format";
import { formatNoteTime } from "../lib/notes";
import {
  assetClassLabel,
  formatPrice,
  quantityWithUnit,
  type AssetClass,
  type CashMovement,
  type Metal,
  type Sample,
  type Snapshot,
  type Trade,
} from "../lib/trading";
import { RANGES, buildSeries, netDeposits, type Range } from "../lib/tradingSeries";
import type { HoldingRow, PositionRow } from "../lib/tradingModel";
import { useTrading, type LiveInfo, type QuoteStatus } from "../lib/useTrading";
import "./TradingView.css";

type Tab = "overview" | "positions" | "assets" | "journal";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Übersicht", icon: LineChart },
  { id: "positions", label: "Positionen", icon: Briefcase },
  { id: "assets", label: "Assets", icon: Coins },
  { id: "journal", label: "Logbuch", icon: NotebookPen },
];

const classIcon: Record<AssetClass, LucideIcon> = { aktie: Building2, krypto: Bitcoin, edelmetall: Gem };
const classColor: Record<AssetClass, string> = { aktie: "var(--accent)", krypto: "var(--ink)", edelmetall: "var(--text-muted)" };

const pnlClass = (v: number) => (v >= 0 ? "tr-pos" : "tr-neg");

/** Zeigt kurz grün oder rot, wenn sich ein Wert ändert. */
function useFlash(value: number): "" | "up" | "down" {
  const previous = useRef(value);
  const [flash, setFlash] = useState<"" | "up" | "down">("");
  useEffect(() => {
    if (Math.abs(value - previous.current) < 0.005) return;
    setFlash(value > previous.current ? "up" : "down");
    previous.current = value;
    const timer = window.setTimeout(() => setFlash(""), 1400);
    return () => window.clearTimeout(timer);
  }, [value]);
  return flash;
}

/** Uhrzeit mit Sekunden in lokaler Zeit. */
const clock = (ms: number) => new Date(ms).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

type Model = ReturnType<typeof useTrading>["model"];

interface ViewProps {
  model: Model;
  openTrade: (id: number) => void;
}

// ---------------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------------

function Overview({ model, snapshots, samples, movements, live, hasData, openTrade, onCash, onMetal }: ViewProps & {
  snapshots: Snapshot[];
  movements: CashMovement[];
  samples: Sample[];
  live: LiveInfo;
  hasData: boolean;
  onCash: () => void;
  onMetal: () => void;
}) {
  const [range, setRange] = useState<Range>("1T");

  // Der letzte Punkt ist immer der aktuelle Gesamtwert, die Linie bewegt sich also mit jedem Kurs
  const series = useMemo(() => buildSeries(range, snapshots, samples, model.total, movements), [range, snapshots, samples, model.total, movements]);
  const first = series.points[0].v;
  const hasSeries = !series.sparse;
  // Auf Rappen gerundet, damit ein Rest von -0.001 nicht als Verlust gilt
  const change = Math.round((model.total - first) * 100) / 100;
  const changePct = hasSeries && first !== 0 ? (change / first) * 100 : 0;
  const color = change >= 0 ? "var(--positive)" : "var(--negative)";
  const flash = useFlash(model.total);
  // Insgesamt: Vermögen minus netto eingezahltes Kapital. Ohne Einzahlungen zählen Verkäufe plus aktuelle Kursgewinne.
  const deposited = netDeposits(movements);
  const profit = deposited > 0 ? model.total - deposited : model.unrealized + model.realizedTotal;

  if (!hasData) {
    return (
      <div className="card tr-empty-state">
        <Wallet size={30} />
        <h3>Starte mit deinem Guthaben</h3>
        <p>
          Lade zuerst Guthaben auf. Danach erfasst du Positionen und Orders, und das Guthaben passt sich bei jedem Kauf und Verkauf automatisch an.
          Edelmetalle trägst du direkt unter Assets ein.
        </p>
        <div className="tr-empty-actions">
          <SecondaryButton onClick={onMetal}>
            <Gem size={16} />
            Edelmetall erfassen
          </SecondaryButton>
          <Button onClick={onCash}>
            <Wallet size={16} />
            Guthaben aufladen
          </Button>
        </div>
      </div>
    );
  }

  const stats = [
    {
      label: "Gesamtvermögen",
      value: formatMoney(model.total),
      hint: hasSeries ? `${formatSigned(change)} CHF (${formatPercent(changePct)})` : "Verlauf entsteht mit der Zeit",
      flash,
      tone: hasSeries ? pnlClass(change) : "",
    },
    {
      label: "Offene Positionen",
      value: String(model.open.length),
      hint: model.open.length ? `${formatSigned(model.unrealized)} CHF unrealisiert` : "Keine offenen Positionen",
      tone: model.open.length ? pnlClass(model.unrealized) : "",
    },
    {
      label: "Gewinn / Verlust",
      value: `${formatSigned(profit)} CHF`,
      hint: deposited > 0 ? `${formatPercent((profit / deposited) * 100)} auf eingezahltes Kapital` : "Realisiert und unrealisiert",
      tone: Math.abs(profit) >= 0.005 ? pnlClass(profit) : "",
    },
    {
      label: "Guthaben",
      value: formatMoney(model.cash),
      hint: model.total > 0 ? `${((model.cash / model.total) * 100).toFixed(1)} % des Vermögens` : "",
      tone: model.cash < 0 ? "tr-neg" : "",
    },
  ];

  const allocation = [
    { label: "Guthaben", value: model.allocation.cash, color: "var(--ink)" },
    { label: "Aktien", value: model.allocation.aktie, color: "var(--accent)" },
    { label: "Krypto", value: model.allocation.krypto, color: "var(--text-muted)" },
    { label: "Edelmetalle", value: model.allocation.edelmetall, color: "var(--border-strong-hover)" },
  ];
  const allocationTotal = allocation.reduce((s, a) => s + a.value, 0);

  return (
    <div className="tr-stack">
      <div className="tr-stats">
        {stats.map((s) => (
          <div key={s.label} className="card tr-stat">
            <span className="card-title">{s.label}</span>
            <div className={`tr-stat-value${s.flash ? ` flash-${s.flash}` : ""}`}>{s.value}</div>
            <div className={`tr-stat-hint ${s.tone}`}>{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="tr-grid-chart">
        <section className="card">
          <div className="tr-card-head">
            <div>
              <h2>Vermögen</h2>
              {hasSeries && (
                <span className={`tr-badge-pnl ${pnlClass(change)}`}>
                  {formatSigned(change)} CHF ({formatPercent(changePct)})
                </span>
              )}
            </div>
            <div className="segmented">
              {RANGES.map((r) => (
                <button key={r} type="button" className={range === r ? "active" : ""} onClick={() => setRange(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <ValueChart points={series.points} color={color} live={live.active} reference={series.invested} />
        </section>

        <section className="card">
          <div className="tr-card-head">
            <h2>Verteilung</h2>
          </div>
          {allocationTotal > 0 ? <Donut segments={allocation} /> : <div className="value-chart-empty">Noch keine Werte vorhanden.</div>}
        </section>
      </div>

      <div className="tr-grid-lists">
        <section className="card">
          <div className="tr-card-head">
            <h2>Offene Positionen</h2>
          </div>
          {model.open.length === 0 ? (
            <p className="muted tr-list-empty">Noch keine offenen Positionen.</p>
          ) : (
            <ul className="tr-mini-list">
              {[...model.open]
                .sort((a, b) => b.valueChf - a.valueChf)
                .slice(0, 5)
                .map((r) => (
                  <li key={r.trade.id} className="clickable" onClick={() => openTrade(r.trade.id)}>
                    <span className="tr-badge">{r.trade.symbol}</span>
                    <div className="tr-mini-main">
                      <span className="tr-name">{r.trade.name}</span>
                      <span className="tr-sub">{quantityWithUnit(r.trade.quantity, r.trade.assetClass, r.trade.symbol)}</span>
                    </div>
                    <div className="tr-mini-side">
                      <span>{formatMoney(r.valueChf)}</span>
                      <span className={`tr-sub ${pnlClass(r.pnlPct)}`}>{formatPercent(r.pnlPct)}</span>
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="tr-card-head">
            <h2>Letzte Aktivität</h2>
          </div>
          {model.activity.length === 0 ? (
            <p className="muted tr-list-empty">Noch keine Aktivität.</p>
          ) : (
            <ul className="tr-mini-list">
              {model.activity.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <span className="tr-activity-icon">
                    {a.kind === "buy" ? <ArrowDownRight size={15} /> : a.kind === "sell" ? <ArrowUpRight size={15} /> : <Wallet size={15} />}
                  </span>
                  <div className="tr-mini-main">
                    <span className="tr-name">{a.title}</span>
                    <span className="tr-sub">{a.detail}</span>
                  </div>
                  <span className="tr-sub">{formatLocalWhen(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Positionen
// ---------------------------------------------------------------------------

interface Row {
  trade: Trade;
  pos?: PositionRow;
  quote?: number;
}

interface Column {
  label: string;
  width?: string;
  align?: "right";
  render: (r: Row) => ReactNode;
}

const symbolCell = ({ trade }: Row) => (
  <div className="tr-symbol">
    <span className="tr-badge">{trade.symbol}</span>
    <div className="tr-symbol-text">
      <span className="tr-name">{trade.name}</span>
      <span className="tr-sub">{assetClassLabel[trade.assetClass]}</span>
    </div>
  </div>
);

const money = (t: Trade, v: number | null | undefined) => (v === null || v === undefined ? "–" : `${formatPrice(v)} ${t.currency}`);

function pnlCell(chf: number, pct: number): ReactNode {
  return (
    <span className={`tr-pnl ${pnlClass(chf)}`}>
      {formatSigned(chf)} CHF
      <small>{formatPercent(pct)}</small>
    </span>
  );
}

const closedFigures = (t: Trade) => {
  const sells = t.executions.filter((e) => e.kind === "sell");
  const sold = sells.reduce((s, e) => s + e.quantity, 0);
  const avgExit = sold > 0 ? sells.reduce((s, e) => s + e.price * e.quantity, 0) / sold : null;
  const bought = t.executions.filter((e) => e.kind === "buy");
  const invested = bought.reduce((s, e) => s + (e.quantity * e.price + e.fee) * t.fxRate, 0);
  return { avgExit, boughtQty: bought.reduce((s, e) => s + e.quantity, 0), pct: invested > 0 ? (t.realizedChf / invested) * 100 : 0 };
};

const COLUMNS: Record<"open" | "closed" | "orders", Column[]> = {
  open: [
    { label: "Position", width: "minmax(180px, 2fr)", render: symbolCell },
    { label: "Menge", render: ({ trade }) => quantityWithUnit(trade.quantity, trade.assetClass, trade.symbol) },
    { label: "Ø Einstieg", render: ({ trade }) => money(trade, trade.avgPrice) },
    {
      label: "Aktuell",
      render: ({ trade, pos }) => (
        <span title={pos?.hasQuote ? undefined : "Noch kein Kurs: Bewertung zum Einstandspreis"}>
          {money(trade, pos?.price)}
          {pos && !pos.hasQuote && <small className="tr-noquote"> ohne Kurs</small>}
        </span>
      ),
    },
    { label: "Gewinn / Verlust", align: "right", render: ({ pos }) => (pos ? pnlCell(pos.pnlChf, pos.pnlPct) : "–") },
    { label: "Stop-Loss", render: ({ trade }) => money(trade, trade.stopLoss) },
    { label: "Ziel", render: ({ trade }) => money(trade, trade.target) },
  ],
  closed: [
    { label: "Position", width: "minmax(180px, 2fr)", render: symbolCell },
    { label: "Menge", render: ({ trade }) => quantityWithUnit(closedFigures(trade).boughtQty, trade.assetClass, trade.symbol) },
    { label: "Ø Einstieg", render: ({ trade }) => money(trade, trade.avgPrice) },
    { label: "Ø Ausstieg", render: ({ trade }) => money(trade, closedFigures(trade).avgExit) },
    { label: "Ergebnis", align: "right", render: ({ trade }) => pnlCell(trade.realizedChf, closedFigures(trade).pct) },
    { label: "Geschlossen", render: ({ trade }) => trade.closedAt?.slice(0, 10) ?? "–" },
  ],
  orders: [
    { label: "Order", width: "minmax(180px, 2fr)", render: symbolCell },
    { label: "Menge", render: ({ trade }) => (trade.plannedQuantity !== null ? quantityWithUnit(trade.plannedQuantity, trade.assetClass, trade.symbol) : "–") },
    { label: "Limit", render: ({ trade }) => money(trade, trade.plannedPrice) },
    { label: "Aktuell", render: ({ trade, quote }) => money(trade, quote) },
    { label: "Stop-Loss", render: ({ trade }) => money(trade, trade.stopLoss) },
    { label: "Ziel", render: ({ trade }) => money(trade, trade.target) },
    { label: "Gültig bis", render: ({ trade }) => trade.validUntil ?? "bis Widerruf" },
  ],
};

const EMPTY_TEXT = {
  open: "Noch keine offenen Positionen. Erfasse sie mit „Neue Position“.",
  closed: "Noch keine geschlossenen Positionen.",
  orders: "Keine offenen Orders.",
} as const;

function Positions({ model, quotes, openTrade }: ViewProps & { quotes: Map<string, number> }) {
  const [filter, setFilter] = useState<"open" | "closed" | "orders">("open");
  const [query, setQuery] = useState("");

  const all: Record<typeof filter, Row[]> = {
    open: model.open.map((pos) => ({ trade: pos.trade, pos })),
    closed: model.closed.map((trade) => ({ trade })),
    orders: model.orders.map((trade) => ({ trade, quote: quotes.get(trade.symbol) })),
  };
  const filters = [
    { id: "open", label: "Offen" },
    { id: "closed", label: "Geschlossen" },
    { id: "orders", label: "Orders" },
  ] as const;

  const columns = COLUMNS[filter];
  const q = query.trim().toLowerCase();
  const rows = all[filter].filter((r) => !q || `${r.trade.symbol} ${r.trade.name}`.toLowerCase().includes(q));
  const template = columns.map((c) => c.width ?? "minmax(90px, 1fr)").join(" ");

  return (
    <div className="tr-stack">
      <div className="tr-toolbar">
        <label className="input tr-search">
          <Search size={14} />
          <input placeholder="Position suchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="segmented">
          {filters.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>
              {f.label} <span className="tr-count">{all[f.id].length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card tr-table">
        <div className="tr-row head" style={{ gridTemplateColumns: template }}>
          {columns.map((c) => (
            <span key={c.label} className={c.align === "right" ? "right" : ""}>
              {c.label}
            </span>
          ))}
        </div>
        {rows.length === 0 && <p className="tr-empty">{all[filter].length === 0 ? EMPTY_TEXT[filter] : "Keine Einträge gefunden."}</p>}
        {rows.map((r) => (
          <div
            key={r.trade.id}
            className="tr-row clickable"
            style={{ gridTemplateColumns: template }}
            tabIndex={0}
            onClick={() => openTrade(r.trade.id)}
            onKeyDown={(e) => e.key === "Enter" && openTrade(r.trade.id)}
          >
            {columns.map((c) => (
              <div key={c.label} className={`tr-cell${c.align === "right" ? " right" : ""}`}>
                {c.render(r)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const ASSET_FILTERS: { id: "all" | AssetClass; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "aktie", label: "Aktien" },
  { id: "krypto", label: "Krypto" },
  { id: "edelmetall", label: "Edelmetalle" },
];

function Assets({ holdings, onMetal, onAsset }: { holdings: HoldingRow[]; onMetal: (m?: Metal) => void; onAsset: (h: HoldingRow) => void }) {
  const [filter, setFilter] = useState<"all" | AssetClass>("all");
  const visible = holdings.filter((h) => filter === "all" || h.assetClass === filter);
  const total = visible.reduce((s, h) => s + h.valueChf, 0);

  return (
    <div className="tr-stack">
      <div className="tr-toolbar">
        <div className="tr-assets-total">
          <span className="card-title">{ASSET_FILTERS.find((f) => f.id === filter)!.label}</span>
          <strong>{formatMoney(total)}</strong>
        </div>
        <div className="tr-toolbar-right">
          <div className="segmented">
            {ASSET_FILTERS.map((f) => (
              <button key={f.id} type="button" className={filter === f.id ? "active" : ""} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <SecondaryButton onClick={() => onMetal()}>
            <Plus size={16} />
            Edelmetall
          </SecondaryButton>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="card tr-empty-state">
          <Coins size={28} />
          <h3>Keine Assets</h3>
          <p>Aktien und Krypto erscheinen hier automatisch aus deinen offenen Positionen. Edelmetalle erfasst du direkt.</p>
        </div>
      ) : (
        <div className="tr-assets">
          {visible.map((h) => {
            const Icon = classIcon[h.assetClass];
            return (
              <article
                key={h.id}
                className="card tr-asset clickable"
                tabIndex={0}
                onClick={() => (h.metal ? onMetal(h.metal) : onAsset(h))}
                onKeyDown={(e) => e.key === "Enter" && (h.metal ? onMetal(h.metal) : onAsset(h))}
              >
                <header className="tr-asset-head">
                  <span className="tr-asset-icon">
                    <Icon size={17} />
                  </span>
                  <div className="tr-symbol-text">
                    <span className="tr-name">{h.name}</span>
                    <span className="tr-sub">
                      {assetClassLabel[h.assetClass]} · {h.tag}
                    </span>
                  </div>
                </header>
                <div className="tr-asset-value">{formatMoney(h.valueChf)}</div>
                <div className={`tr-asset-pnl ${h.pnlPct === null ? "" : pnlClass(h.pnlPct)}`}>
                  {h.pnlPct === null ? (h.estimated ? "ohne aktuellen Kurs" : "–") : formatPercent(h.pnlPct)}
                </div>
                <dl className="tr-asset-meta">
                  <div>
                    <dt>Menge</dt>
                    <dd>{h.amount}</dd>
                  </div>
                  <div>
                    <dt>Kurs</dt>
                    <dd>{h.unitPrice}</dd>
                  </div>
                </dl>
                <div className="tr-share" title={`${total > 0 ? ((h.valueChf / total) * 100).toFixed(1) : 0} % der Auswahl`}>
                  <div className="tr-share-fill" style={{ width: `${total > 0 ? (h.valueChf / total) * 100 : 0}%`, backgroundColor: classColor[h.assetClass] }} />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ansicht
// ---------------------------------------------------------------------------

function quoteMessage(status: QuoteStatus): { text: string; error: boolean } | null {
  if (status.kind === "error") return { text: status.message, error: true };
  if (status.kind === "ok") {
    if (status.failed.length > 0) return { text: `Kein Kurs für: ${status.failed.join(", ")}`, error: true };
    return { text: status.updated === 0 ? "Keine Kurse zu aktualisieren." : `${status.updated} ${status.updated === 1 ? "Kurs" : "Kurse"} aktualisiert.`, error: false };
  }
  return null;
}

type Modal = null | { kind: "asset"; id: string } | { kind: "cash" } | { kind: "position" } | { kind: "trade"; id: number } | { kind: "metal"; metal?: Metal };

export function TradingView() {
  const { state, model, snapshots, samples, loaded, error, quoteStatus, updateQuotes, live } = useTrading({ live: true });
  const { openSettings } = useDialogs();
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<Modal>(null);
  // Aus der Suche: Position öffnen
  useOpenTarget("trade", (t) => {
    setTab("positions");
    setModal({ kind: "trade", id: t.id });
  });

  const quotes = useMemo(() => new Map(state.quotes.map((q) => [q.symbol, q.price])), [state.quotes]);
  const hasData = state.movements.length > 0 || state.trades.length > 0 || state.metals.length > 0;
  const lastQuote = state.quotes.reduce<string | null>((latest, q) => (latest === null || q.updatedAt > latest ? q.updatedAt : latest), null);

  // Im Live-Betrieb melden sich nur Fehler; die Erfolgsmeldung der Handaktualisierung bleibt für den Knopf
  const message = quoteMessage(quoteStatus) ?? (live.error ? { text: live.error, error: true } : null);
  const assetHolding = modal?.kind === "asset" ? model.holdings.find((h) => h.id === modal.id) : undefined;
  const trade = modal?.kind === "trade" ? state.trades.find((t) => t.id === modal.id) : undefined;

  // Wurde die Position gelöscht, schließt sich der Dialog
  useEffect(() => {
    if (loaded && modal?.kind === "trade" && !trade) setModal(null);
  }, [loaded, modal, trade]);

  const refresh = () => (state.hasApiKey ? void updateQuotes() : openSettings("trading"));

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Trading</h1>
            <p className={`page-subtitle${message?.error ? " tr-neg" : ""}`}>
              {message
                ? message.text
                : live.active && live.lastAt
                  ? `Basiswährung CHF · Live-Kurse, zuletzt ${clock(live.lastAt)}`
                  : lastQuote
                  ? `Basiswährung CHF · Kurse ${formatNoteTime(lastQuote)}`
                  : state.hasApiKey
                    ? "Basiswährung CHF"
                    : "Basiswährung CHF · Für Kurse den Finnhub-Key unter Einstellungen eintragen"}
            </p>
          </div>
          <div className="page-actions">
            <SecondaryButton onClick={refresh} disabled={quoteStatus.kind === "loading"} title={state.hasApiKey ? "Kurse jetzt aktualisieren" : "API-Key nötig"}>
              <RefreshCw size={16} className={quoteStatus.kind === "loading" ? "spin" : ""} />
              Kurse
            </SecondaryButton>
            <SecondaryButton onClick={() => setModal({ kind: "cash" })}>
              <Wallet size={16} />
              Guthaben
            </SecondaryButton>
            <Button onClick={() => setModal({ kind: "position" })}>
              <Plus size={16} />
              Neue Position
            </Button>
          </div>
        </div>

        <div className="tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="page-body">
        {error && <p className="field-error">Trading-Daten konnten nicht geladen werden: {error}</p>}
        {loaded && tab === "overview" && (
          <Overview
            model={model}
            snapshots={snapshots}
            samples={samples}
            movements={state.movements}
            live={live}
            hasData={hasData}
            openTrade={(id) => setModal({ kind: "trade", id })}
            onCash={() => setModal({ kind: "cash" })}
            onMetal={() => setModal({ kind: "metal" })}
          />
        )}
        {loaded && tab === "positions" && <Positions model={model} quotes={quotes} openTrade={(id) => setModal({ kind: "trade", id })} />}
        {loaded && tab === "journal" && <JournalPage onOpenTrade={(id) => setModal({ kind: "trade", id })} />}
        {loaded && tab === "assets" && <Assets holdings={model.holdings} onMetal={(metal) => setModal({ kind: "metal", metal })} onAsset={(h) => setModal({ kind: "asset", id: h.id })} />}
      </div>

      {assetHolding && (
        <AssetModal
          holding={assetHolding}
          trades={state.trades.filter((t) => assetHolding.tradeIds?.includes(t.id))}
          onOpenTrade={(id) => setModal({ kind: "trade", id })}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "cash" && <CashModal cash={model.cash} movements={state.movements} onClose={() => setModal(null)} />}
      {modal?.kind === "position" && <PositionModal cash={model.cash} hasApiKey={state.hasApiKey} onClose={() => setModal(null)} />}
      {modal?.kind === "metal" && <MetalModal key={modal.metal?.id ?? "new"} metal={modal.metal} onClose={() => setModal(null)} />}
      {trade && (
        <TradeModal
          key={trade.id}
          trade={trade}
          price={quotes.get(trade.symbol) ?? null}
          quoteAt={state.quotes.find((q) => q.symbol === trade.symbol)?.updatedAt ?? null}
          cash={model.cash}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
