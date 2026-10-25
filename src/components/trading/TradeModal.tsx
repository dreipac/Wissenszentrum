import { useState } from "react";
import { Pencil } from "lucide-react";
import { Modal } from "../ui/Modal";
import { DatePicker, DateTimeField } from "../ui/DatePicker";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { addJournal } from "../../lib/api/journal";
import { addExecution, deleteTrade, executeOrder, setQuote, updateTrade } from "../../lib/api/trading";
import { formatMoney, formatPercent, formatSigned } from "../../lib/format";
import { assetClassLabel, formatPrice, formatQuantity, quantityWithUnit, type Trade } from "../../lib/trading";
import { formatNoteTime } from "../../lib/notes";
import { AssetInsight } from "./AssetInsight";
import { TradeJournal } from "./Journal";
import { entryTime, KIND_LABEL, TOPIC_LABEL } from "../../lib/journal";
import { useJournal } from "../../lib/useJournal";
import { useStrategies } from "../../lib/useStrategies";
import { CurrencySuffix, Field, NumberField, TextSuffix, fromInput, nowInput, parseNumber } from "./fields";
import { useQtyValue } from "./useQtyValue";
import "./TradingModals.css";

type Panel = null | "buy" | "sell" | "execute" | "edit" | "quote";

interface TradeModalProps {
  trade: Trade;
  /** Aktueller Kurs (Positionswährung) und Zeitpunkt, falls vorhanden */
  price: number | null;
  quoteAt: string | null;
  cash: number;
  onClose: () => void;
}

const statusLabel = { order: "Order", open: "Offen", closed: "Geschlossen" } as const;
const tone = (v: number) => (v >= 0 ? "tr-pos" : "tr-neg");

export function TradeModal({ trade, price, quoteAt, cash, onClose }: TradeModalProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { entries } = useJournal();
  const { strategies } = useStrategies();
  const ownEntries = entries.filter((e) => e.tradeId === trade.id);
  const relatedStrategyId = strategies.find((st) => st.nodes.some((n) => n.symbol.trim().toUpperCase() === trade.symbol.toUpperCase()))?.id ?? null;
  const toImprove = ownEntries.filter((e) => e.kind === "improve" || e.kind === "mistake");

  // Formularfelder der Panels
  const [px, setPx] = useState("");
  const qv = useQtyValue(px);
  const [fee, setFee] = useState("");
  const [at, setAt] = useState(nowInput);
  const [fx, setFx] = useState("");
  const [note, setNote] = useState("");
  // Rückblick beim Schließen
  const [reviewGood, setReviewGood] = useState("");
  const [reviewBetter, setReviewBetter] = useState("");
  const [name, setName] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [thesis, setThesis] = useState("");
  const [valid, setValid] = useState("");

  const cur = trade.currency;
  const isChf = cur === "CHF";
  const ref = price ?? trade.avgPrice;
  const buys = trade.executions.filter((e) => e.kind === "buy");
  const sells = trade.executions.filter((e) => e.kind === "sell");
  const boughtQty = buys.reduce((s, e) => s + e.quantity, 0);
  const soldQty = sells.reduce((s, e) => s + e.quantity, 0);
  const avgExit = soldQty > 0 ? sells.reduce((s, e) => s + e.price * e.quantity, 0) / soldQty : null;

  // Bewertung der offenen Menge
  const valueChf = trade.quantity * ref * trade.fxRate;
  const pnlChf = valueChf - trade.costChf;
  const pnlPct = trade.costChf > 0 ? (pnlChf / trade.costChf) * 100 : 0;
  const away = (level: number | null) => (level === null || ref === 0 ? null : ((level - ref) / ref) * 100);
  // Ergebnis bei geschlossenen Positionen im Verhältnis zum eingesetzten Kapital
  const investedChf = trade.executions.filter((e) => e.kind === "buy").reduce((s, e) => s + (e.quantity * e.price + e.fee) * trade.fxRate, 0);
  const realizedPct = investedChf > 0 ? (trade.realizedChf / investedChf) * 100 : 0;

  const money = (v: number) => `${formatPrice(v)} ${cur}`;

  const openPanel = (p: Exclude<Panel, null>) => {
    setError(null);
    setPanel(p);
    setFee("");
    setNote("");
    setReviewGood("");
    setReviewBetter("");
    setAt(nowInput());
    setFx(String(trade.fxRate));
    if (p === "buy" || p === "sell" || p === "execute") {
      const nextQty = p === "buy" ? "" : p === "sell" ? String(trade.quantity) : trade.plannedQuantity !== null ? String(trade.plannedQuantity) : "";
      const planned = p === "execute" ? trade.plannedPrice : price;
      const nextPx = planned !== null ? String(planned) : "";
      setPx(nextPx);
      qv.reset(nextQty, nextPx);
    } else if (p === "edit") {
      setName(trade.name);
      setStop(trade.stopLoss !== null ? String(trade.stopLoss) : "");
      setTarget(trade.target !== null ? String(trade.target) : "");
      setThesis(trade.thesis);
      setValid(trade.validUntil ?? "");
    } else if (p === "quote") {
      setPx(price !== null ? String(price) : "");
    }
  };

  const run = async (action: () => Promise<unknown>, close = true) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (close) setPanel(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const q = parseNumber(qv.qty);
  const p = parseNumber(px);
  const f = parseNumber(fee) ?? 0;
  const rate = isChf ? 1 : parseNumber(fx);
  const sellsAll = panel === "sell" && q !== null && q >= trade.quantity - 1e-9;
  const avgCostPerUnit = trade.quantity > 0 ? trade.costChf / (trade.quantity * trade.fxRate) : 0;
  const sellResult = panel === "sell" && q !== null && p !== null ? ((p * q - f) - avgCostPerUnit * q) * trade.fxRate : null;
  const buyCost = (panel === "buy" || panel === "execute") && q !== null && p !== null && rate !== null ? (q * p + f) * rate : null;
  const tooExpensive = buyCost !== null && buyCost > cash + 0.005;
  // Erlös eines Verkaufs in Positionswährung und als Gutschrift in CHF
  const sellProceeds = panel === "sell" && q !== null && p !== null ? p * q - f : null;
  const worth = q !== null && p !== null ? q * p : null;

  const submitExecution = () => {
    if (q === null || q <= 0) return setError("Bitte gib eine Menge größer als 0 ein.");
    if (p === null || p <= 0) return setError("Bitte gib einen Preis größer als 0 ein.");
    if (rate === null || rate <= 0) return setError(`Bitte gib den Wechselkurs ein (CHF je 1 ${cur}).`);
    if (tooExpensive) return setError("Das Guthaben reicht nicht. Lade zuerst Guthaben auf.");
    const input = {
      kind: panel === "sell" ? ("sell" as const) : ("buy" as const),
      quantity: q,
      price: p,
      fee: f,
      executedAt: fromInput(at),
      fxRate: panel === "execute" && !isChf ? rate : null,
      closeNote: sellsAll ? note : "",
    };
    const good = sellsAll ? reviewGood.trim() : "";
    const better = sellsAll ? reviewBetter.trim() : "";
    const review = { tradeId: trade.id, topic: "" as const, price: p, pnlPct: trade.avgPrice > 0 ? (p / trade.avgPrice - 1) * 100 : null };
    void run(async () => {
      await (panel === "execute" ? executeOrder(trade.id, input) : addExecution(trade.id, input));
      // Der Rückblick wird Teil des Logbuchs; „Besser machen“ wird zur Regel der passenden Strategie
      if (good) await addJournal({ ...review, kind: "good", text: good, nextTime: "", strategyId: null });
      if (better) await addJournal({ ...review, kind: "improve", text: better, nextTime: "", strategyId: relatedStrategyId });
    });
  };

  const submitEdit = () => {
    const fxValue = isChf ? 1 : parseNumber(fx);
    if (fxValue === null || fxValue <= 0) return setError(`Bitte gib den Wechselkurs ein (CHF je 1 ${cur}).`);
    void run(() =>
      updateTrade(trade.id, { name, stopLoss: parseNumber(stop), target: parseNumber(target), thesis, fxRate: fxValue, validUntil: valid || null }),
    );
  };

  const submitQuote = () => {
    if (p === null || p <= 0) return setError("Bitte gib einen Kurs größer als 0 ein.");
    void run(() => setQuote(trade.symbol, p));
  };

  const kpis: { label: string; value: React.ReactNode; sub?: React.ReactNode }[] =
    trade.status === "order"
      ? [
          { label: "Geplante Menge", value: trade.plannedQuantity !== null ? quantityWithUnit(trade.plannedQuantity, trade.assetClass, trade.symbol) : "–" },
          { label: "Limit-Preis", value: trade.plannedPrice !== null ? money(trade.plannedPrice) : "–" },
          { label: "Gültig bis", value: trade.validUntil ?? "bis auf Widerruf" },
          { label: "Stop-Loss", value: trade.stopLoss !== null ? money(trade.stopLoss) : "–" },
          { label: "Ziel", value: trade.target !== null ? money(trade.target) : "–" },
          {
            label: "Aktueller Kurs",
            value: price !== null ? money(price) : "kein Kurs",
            sub: quoteAt ? `Stand ${formatNoteTime(quoteAt)}` : undefined,
          },
        ]
      : trade.status === "open"
        ? [
            { label: "Menge", value: quantityWithUnit(trade.quantity, trade.assetClass, trade.symbol) },
            { label: "Ø Einstieg", value: money(trade.avgPrice) },
            {
              label: "Aktueller Kurs",
              value: price !== null ? money(price) : "kein Kurs",
              sub: quoteAt ? `Stand ${formatNoteTime(quoteAt)}` : "Wert zum Einstandspreis",
            },
            { label: "Wert", value: formatMoney(valueChf) },
            {
              label: "Gewinn / Verlust",
              value: <span className={tone(pnlChf)}>{formatSigned(pnlChf)} CHF</span>,
              sub: <span className={tone(pnlPct)}>{formatPercent(pnlPct)}</span>,
            },
            {
              label: "Stop-Loss",
              value: trade.stopLoss !== null ? money(trade.stopLoss) : "–",
              sub: away(trade.stopLoss) !== null ? `${formatSigned(away(trade.stopLoss)!, 1)} % zum Kurs` : undefined,
            },
            {
              label: "Ziel",
              value: trade.target !== null ? money(trade.target) : "–",
              sub: away(trade.target) !== null ? `${formatSigned(away(trade.target)!, 1)} % zum Kurs` : undefined,
            },
            { label: "Realisiert (Teilverkäufe)", value: <span className={tone(trade.realizedChf)}>{formatSigned(trade.realizedChf)} CHF</span> },
          ]
        : [
            { label: "Gekauft", value: quantityWithUnit(boughtQty, trade.assetClass, trade.symbol) },
            { label: "Ø Einstieg", value: money(trade.avgPrice) },
            { label: "Ø Ausstieg", value: avgExit !== null ? money(avgExit) : "–" },
            {
              label: "Ergebnis",
              value: <span className={tone(trade.realizedChf)}>{formatSigned(trade.realizedChf)} CHF</span>,
              sub: <span className={tone(realizedPct)}>{formatPercent(realizedPct)}</span>,
            },
            { label: "Geschlossen am", value: trade.closedAt ?? "–" },
            { label: "Ziel", value: trade.target !== null ? money(trade.target) : "–", sub: trade.target !== null && avgExit !== null ? (avgExit >= trade.target ? "erreicht" : "nicht erreicht") : undefined },
          ];

  const panelTitle = { buy: "Nachkaufen", sell: "Verkaufen", execute: "Order ausführen", edit: "Bearbeiten", quote: "Kurs eintragen" } as const;

  return (
    <Modal
      title={trade.name}
      width={760}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton className="danger" onClick={() => setConfirmDelete(true)}>
            Löschen
          </SecondaryButton>
          <span className="spacer" />
          {trade.status !== "closed" && (
            <SecondaryButton onClick={() => openPanel("edit")}>
              <Pencil size={14} />
              Bearbeiten
            </SecondaryButton>
          )}
          {trade.status === "open" && (
            <>
              <SecondaryButton onClick={() => openPanel("buy")}>Nachkaufen</SecondaryButton>
              <Button onClick={() => openPanel("sell")}>Verkaufen</Button>
            </>
          )}
          {trade.status === "order" && <Button onClick={() => openPanel("execute")}>Order ausführen</Button>}
          {trade.status === "closed" && <SecondaryButton onClick={onClose}>Schließen</SecondaryButton>}
        </>
      }
    >
      <div className="tr-trade-head">
        <span className="tr-badge">{trade.symbol}</span>
        <span className="tr-sub">
          {assetClassLabel[trade.assetClass]} · {cur}
          {!isChf && ` · 1 ${cur} = ${formatPrice(trade.fxRate)} CHF`}
        </span>
        <span className={`tr-status ${trade.status}`}>{statusLabel[trade.status]}</span>
        {trade.status !== "closed" && (
          <button type="button" className="icon-btn tr-quote-btn" aria-label="Kurs eintragen" title="Kurs von Hand eintragen" onClick={() => openPanel("quote")}>
            <Pencil size={13} />
            <span>Kurs</span>
          </button>
        )}
      </div>

      <div className="tr-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="tr-kpi">
            <span className="tr-kpi-label">{k.label}</span>
            <span className="tr-kpi-value">{k.value}</span>
            {k.sub && <span className="tr-kpi-sub">{k.sub}</span>}
          </div>
        ))}
      </div>

      <AssetInsight symbol={trade.symbol} assetClass={trade.assetClass} currency={cur} price={price}
        entry={trade.status === "order" ? trade.plannedPrice : trade.avgPrice}
        markers={ownEntries.map((e) => ({
          t: entryTime(e),
          label: `${KIND_LABEL[e.kind]}${e.topic ? ` · ${TOPIC_LABEL[e.topic]}` : ""}: ${e.text.length > 80 ? `${e.text.slice(0, 80)} …` : e.text}`,
          color: e.kind === "mistake" ? "var(--negative)" : e.kind === "improve" ? "var(--warning)" : e.kind === "good" ? "var(--positive)" : "var(--accent)",
        }))}
      />

      <TradeJournal
        trade={{ id: trade.id, symbol: trade.symbol, currency: cur }}
        price={price ?? (trade.status === "open" ? trade.avgPrice : null)}
        pnlPct={trade.status === "open" ? pnlPct : null}
        entries={entries}
        strategies={strategies}
      />

      {trade.thesis && (
        <div className="tr-text-block">
          <span className="tm2-sub">Grund / These</span>
          <p>{trade.thesis}</p>
        </div>
      )}
      {trade.closeNote && (
        <div className="tr-text-block">
          <span className="tm2-sub">Notiz zum Abschluss</span>
          <p>{trade.closeNote}</p>
        </div>
      )}

      {trade.executions.length > 0 && (
        <div>
          <span className="tm2-sub">Ausführungen</span>
          <div className="tr-exec">
            <div className="tr-exec-row head">
              <span>Art</span>
              <span>Zeitpunkt</span>
              <span className="right">Menge</span>
              <span className="right">Preis</span>
              <span className="right">Gebühr</span>
              <span className="right">Ergebnis</span>
            </div>
            {trade.executions.map((e) => (
              <div key={e.id} className="tr-exec-row">
                <span>{e.kind === "buy" ? "Kauf" : "Verkauf"}</span>
                <span>{e.executedAt}</span>
                <span className="right">{formatQuantity(e.quantity)}</span>
                <span className="right">{money(e.price)}</span>
                <span className="right">{e.fee > 0 ? money(e.fee) : "–"}</span>
                <span className={`right ${e.kind === "sell" ? tone(e.realizedChf) : ""}`}>
                  {e.kind === "sell" ? `${formatSigned(e.realizedChf)} CHF` : "–"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {panel && (
        <section className="tr-panel" aria-label={panelTitle[panel]}>
          <h3>{panelTitle[panel]}</h3>

          {(panel === "buy" || panel === "sell" || panel === "execute") && (
            <div className="tm2-grid">
              <NumberField
                label="Menge"
                id="tp-qty"
                value={qv.qty}
                onChange={qv.setQty}
                autoFocus
                hint={panel === "sell" ? `Du hältst ${formatQuantity(trade.quantity)}` : undefined}
                suffix={trade.assetClass === "aktie" ? <TextSuffix>Stk.</TextSuffix> : undefined}
              />
              <NumberField label="Preis" id="tp-price" value={px} onChange={setPx} suffix={<CurrencySuffix value={cur} />} />
              <NumberField
                label={panel === "sell" ? "Erlös (Menge × Preis)" : "Wert (Menge × Preis)"}
                id="tp-worth"
                value={qv.value}
                onChange={qv.setValue}
                placeholder="Betrag eintippen, um die Menge zu errechnen"
                suffix={<CurrencySuffix value={cur} />}
              />
              <NumberField label="Gebühr (optional)" id="tp-fee" value={fee} onChange={setFee} placeholder="0" suffix={<CurrencySuffix value={cur} />} />
              <Field label="Zeitpunkt" id="tp-at">
                <DateTimeField id="tp-at" ariaLabel="Zeitpunkt" value={at} onChange={setAt} />
              </Field>
              {panel === "execute" && !isChf && (
                <NumberField label={`Wechselkurs (CHF je 1 ${cur})`} id="tp-fx" value={fx} onChange={setFx} suffix={<TextSuffix>CHF</TextSuffix>} />
              )}
              {sellsAll && (
                <div className="full">
                  <Field label="Notiz zum Abschluss (optional)" id="tp-note" hint="Die Position wird damit geschlossen.">
                    <textarea
                      id="tp-note"
                      className="field-control"
                      value={note}
                      placeholder={trade.target !== null ? "Wurde das Ziel erreicht? Was hast du gelernt?" : "Was hast du gelernt?"}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                </div>
              )}
              {sellsAll && (
                <div className="full jr-review">
                  {toImprove.length > 0 && (
                    <div className="jr-review-hint">
                      <strong>Aus deinem Logbuch</strong>
                      {toImprove.map((e) => (
                        <span key={e.id}>{e.nextTime || e.text}</span>
                      ))}
                    </div>
                  )}
                  <div className="tm2-grid">
                    <Field label="Was lief gut? (optional)" id="tp-good">
                      <textarea id="tp-good" className="field-control" rows={2} value={reviewGood} onChange={(e) => setReviewGood(e.target.value)} />
                    </Field>
                    <Field label="Was würde ich anders machen? (optional)" id="tp-better" hint={relatedStrategyId !== null ? "Wird zur Regel der passenden Strategie." : undefined}>
                      <textarea id="tp-better" className="field-control" rows={2} value={reviewBetter} onChange={(e) => setReviewBetter(e.target.value)} />
                    </Field>
                  </div>
                </div>
              )}
            </div>
          )}

          {panel === "sell" && sellResult !== null && sellProceeds !== null && (
            <div className="tm2-summary" aria-live="polite">
              <div>
                <span>Erlös{f > 0 ? " nach Gebühr" : ""}</span>
                <strong>{money(sellProceeds)}</strong>
              </div>
              <div>
                <span>Gutschrift{!isChf ? ` (Kurs ${formatPrice(trade.fxRate)})` : ""}</span>
                <strong>{formatMoney(sellProceeds * trade.fxRate)}</strong>
              </div>
              <div>
                <span>Guthaben danach</span>
                <strong>{formatMoney(cash + sellProceeds * trade.fxRate)}</strong>
              </div>
              <div>
                <span>Ergebnis dieses Verkaufs</span>
                <strong className={tone(sellResult)}>{formatSigned(sellResult)} CHF</strong>
              </div>
            </div>
          )}
          {buyCost !== null && worth !== null && (
            <div className="tm2-summary" aria-live="polite">
              <div>
                <span>Wert (Menge × Preis)</span>
                <strong>{money(worth)}</strong>
              </div>
              {f > 0 && (
                <div>
                  <span>Gebühr</span>
                  <strong>{money(f)}</strong>
                </div>
              )}
              <div>
                <span>Kaufbetrag{!isChf && rate !== null ? ` (Kurs ${formatPrice(rate)})` : ""}</span>
                <strong>{formatMoney(buyCost)}</strong>
              </div>
              <div>
                <span>Guthaben jetzt</span>
                <strong>{formatMoney(cash)}</strong>
              </div>
              <div className={tooExpensive ? "warn" : ""}>
                <span>Guthaben danach</span>
                <strong>{formatMoney(cash - buyCost)}</strong>
              </div>
            </div>
          )}

          {panel === "edit" && (
            <div className="tm2-grid">
              <div className="full">
                <Field label="Name" id="te-name">
                  <input id="te-name" className="field-control" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
              </div>
              <NumberField label="Stop-Loss" id="te-stop" value={stop} onChange={setStop} suffix={<CurrencySuffix value={cur} />} />
              <NumberField label="Ziel" id="te-target" value={target} onChange={setTarget} suffix={<CurrencySuffix value={cur} />} />
              {!isChf && (
                <div className="full">
                  <NumberField label={`Wechselkurs (CHF je 1 ${cur})`} id="te-fx" value={fx} onChange={setFx} suffix={<TextSuffix>CHF</TextSuffix>} />
                </div>
              )}
              {trade.status === "order" && (
                <div className="full">
                  <Field label="Gültig bis" id="te-valid">
                    <DatePicker id="te-valid" ariaLabel="Gültig bis" value={valid} onChange={setValid} />
                  </Field>
                </div>
              )}
              <div className="full">
                <Field label="Grund / These" id="te-thesis">
                  <textarea id="te-thesis" className="field-control" value={thesis} onChange={(e) => setThesis(e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {panel === "quote" && (
            <NumberField
              label={`Aktueller Kurs von ${trade.symbol}`}
              id="tq-price"
              value={px}
              onChange={setPx}
              autoFocus
              hint="Gilt, bis Kurse über Finnhub aktualisiert werden."
              suffix={<CurrencySuffix value={cur} />}
            />
          )}

          {error && <p className="field-error">{error}</p>}
          <div className="tr-panel-actions">
            <SecondaryButton onClick={() => setPanel(null)}>Abbrechen</SecondaryButton>
            <Button
              disabled={busy || tooExpensive}
              onClick={panel === "edit" ? submitEdit : panel === "quote" ? submitQuote : submitExecution}
            >
              {panel === "buy" ? "Nachkauf buchen" : panel === "sell" ? (sellsAll ? "Position schließen" : "Verkauf buchen") : panel === "execute" ? "Order ausführen" : "Speichern"}
            </Button>
          </div>
        </section>
      )}

      {!panel && error && <p className="field-error">{error}</p>}

      {confirmDelete && (
        <ConfirmDialog
          title={trade.status === "order" ? "Order löschen?" : "Position löschen?"}
          message={
            trade.executions.length > 0
              ? `„${trade.name}“ wird samt ${trade.executions.length} ${trade.executions.length === 1 ? "Ausführung" : "Ausführungen"} dauerhaft gelöscht. Das Guthaben passt sich entsprechend an.`
              : `„${trade.name}“ wird dauerhaft gelöscht.`
          }
          busy={busy}
          onConfirm={() => void run(async () => { await deleteTrade(trade.id); onClose(); }, false)}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
