import { useEffect, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { addJournal, deleteJournal, updateJournal } from "../../lib/api/journal";
import { formatPercent } from "../../lib/format";
import { KINDS, KIND_LABEL, TOPICS, TOPIC_LABEL, ago, type JournalEdit, type JournalEntry, type JournalKind, type JournalTopic } from "../../lib/journal";
import { formatPrice } from "../../lib/trading";
import type { Strategy } from "../../lib/strategies";
import "./Journal.css";

const PLACEHOLDER: Record<JournalKind, string> = {
  observation: "Was fällt dir gerade auf?",
  mistake: "Was ist schiefgelaufen?",
  improve: "Was kannst du besser machen?",
  good: "Was lief gut?",
};

/** Kleine Marke der Art eines Eintrags (Farbe je Art). */
export function KindChip({ kind }: { kind: JournalKind }) {
  return <span className={`jr-chip ${kind}`}>{KIND_LABEL[kind]}</span>;
}

interface ComposerProps {
  /** Bestehender Eintrag beim Bearbeiten */
  initial?: JournalEntry;
  /** Beim Neuanlegen: Position und der Stand, mit dem der Eintrag gespeichert wird */
  trade?: { id: number; currency: string; price: number | null; pnlPct: number | null };
  strategies: Strategy[];
  /** Vorgewählte Strategie beim Neuanlegen */
  defaultStrategyId?: number | null;
  onDone: () => void;
  autoFocus?: boolean;
}

/** Eingabe für einen neuen oder bestehenden Eintrag: Art, Text, bei „Besser machen“ auch „Nächstes Mal“ und Strategie. */
export function JournalComposer({ initial, trade, strategies, defaultStrategyId = null, onDone, autoFocus }: ComposerProps) {
  const [kind, setKind] = useState<JournalKind>(initial?.kind ?? "observation");
  const [text, setText] = useState(initial?.text ?? "");
  const [nextTime, setNextTime] = useState(initial?.nextTime ?? "");
  const [topic, setTopic] = useState<JournalTopic>(initial?.topic ?? "");
  const [strategyId, setStrategyId] = useState<number | null>(initial ? initial.strategyId : defaultStrategyId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const strategyTouched = useRef(false);

  // Die Strategien laden evtl. erst nach dem ersten Zeichnen: die Vorwahl nachziehen, solange man nichts gewählt hat
  useEffect(() => {
    if (!initial && !strategyTouched.current) setStrategyId(defaultStrategyId);
  }, [defaultStrategyId, initial]);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  const save = async () => {
    if (!text.trim()) return setError("Bitte schreibe etwas in die Notiz.");
    setBusy(true);
    setError(null);
    const edit: JournalEdit = { kind, topic, text, nextTime: kind === "improve" ? nextTime : "", strategyId: kind === "improve" ? strategyId : null };
    try {
      if (initial) await updateJournal(initial.id, edit);
      else if (trade) await addJournal({ ...edit, tradeId: trade.id, price: trade.price, pnlPct: trade.pnlPct });
      setText("");
      setNextTime("");
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const meta = trade && trade.price !== null ? `Wird mit Kurs ${formatPrice(trade.price)} ${trade.currency}${trade.pnlPct !== null ? ` · ${formatPercent(trade.pnlPct)}` : ""} gespeichert` : null;

  return (
    <div className="jr-composer">
      <div className="jr-kinds" role="radiogroup" aria-label="Art des Eintrags">
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`jr-kind ${k}${kind === k ? " active" : ""}`} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <textarea
        ref={area}
        className="field-control jr-text"
        rows={2}
        value={text}
        maxLength={2000}
        placeholder={PLACEHOLDER[kind]}
        aria-label="Notiz"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && void save()}
      />
      {kind === "improve" && (
        <input
          className="field-control"
          value={nextTime}
          maxLength={500}
          placeholder="Nächstes Mal … (z. B. Stop-Loss gleich beim Einstieg setzen)"
          aria-label="Nächstes Mal"
          onChange={(e) => setNextTime(e.target.value)}
        />
      )}
      <div className="jr-options">
        <select className="field-control" value={topic} aria-label="Thema" onChange={(e) => setTopic(e.target.value as JournalTopic)}>
          <option value="">Thema (optional)</option>
          {TOPICS.map((t) => (
            <option key={t} value={t}>
              {TOPIC_LABEL[t]}
            </option>
          ))}
        </select>
        {kind === "improve" && (
          <select className="field-control" value={strategyId ?? ""} aria-label="Strategie" onChange={(e) => {
              strategyTouched.current = true;
              setStrategyId(e.target.value ? Number(e.target.value) : null);
            }}>
            <option value="">Keine Strategie</option>
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>
                Regel für: {s.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="field-error">{error}</p>}
      <div className="jr-composer-foot">
        <span className="jr-meta">{initial ? "Zeitpunkt und Kurs bleiben erhalten" : meta}</span>
        {initial && (
          <SecondaryButton className="sm" onClick={onDone}>
            Abbrechen
          </SecondaryButton>
        )}
        <Button className="sm" disabled={busy || !text.trim()} onClick={() => void save()}>
          {initial ? "Speichern" : "Hinzufügen"}
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  entry: JournalEntry;
  strategies: Strategy[];
  /** Zeigt die Position (Symbol) vor dem Text, z. B. in der Gesamtübersicht */
  showTrade?: boolean;
  onOpenTrade?: (id: number) => void;
}

/** Ein Eintrag im Logbuch mit Meta-Zeile; bearbeiten und löschen auf Wunsch. */
export function JournalEntryRow({ entry, strategies, showTrade, onOpenTrade }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strategy = strategies.find((s) => s.id === entry.strategyId);

  if (editing) {
    return (
      <li className="jr-entry editing">
        <JournalComposer initial={entry} strategies={strategies} onDone={() => setEditing(false)} autoFocus />
      </li>
    );
  }

  const remove = async () => {
    setConfirming(false);
    try {
      await deleteJournal(entry.id);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <li className={`jr-entry ${entry.kind}`}>
      <div className="jr-entry-head">
        <KindChip kind={entry.kind} />
        {showTrade &&
          (onOpenTrade ? (
            <button type="button" className="jr-trade" onClick={() => onOpenTrade(entry.tradeId)} title={entry.tradeName}>
              {entry.symbol}
            </button>
          ) : (
            <span className="jr-trade static">{entry.symbol}</span>
          ))}
        {entry.topic && <span className="jr-topic">{TOPIC_LABEL[entry.topic]}</span>}
        <span className="jr-spacer" />
        <span className="jr-actions">
          <button type="button" className="icon-btn" aria-label="Bearbeiten" title="Bearbeiten" onClick={() => setEditing(true)}>
            <Pencil size={13} />
          </button>
          <button type="button" className="icon-btn" aria-label="Löschen" title="Löschen" onClick={() => setConfirming(true)}>
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      <p className="jr-entry-text">{entry.text}</p>
      {entry.nextTime && (
        <p className="jr-next">
          <span>Nächstes Mal</span> {entry.nextTime}
        </p>
      )}
      <div className="jr-entry-meta">
        {entry.price !== null && <span>Kurs {formatPrice(entry.price)}</span>}
        {entry.pnlPct !== null && <span>{formatPercent(entry.pnlPct)}</span>}
        {strategy && <span>Regel für {strategy.title}</span>}
        <span>{ago(entry)}</span>
      </div>
      {error && <p className="field-error">{error}</p>}
      {confirming && (
        <ConfirmDialog title="Eintrag löschen?" message="Der Eintrag verschwindet aus dem Logbuch." confirmLabel="Löschen" onConfirm={() => void remove()} onCancel={() => setConfirming(false)} />
      )}
    </li>
  );
}

interface JournalProps {
  trade: { id: number; symbol: string; currency: string };
  /** Kurs und Stand, mit dem neue Einträge gespeichert werden */
  price: number | null;
  pnlPct: number | null;
  entries: JournalEntry[];
  strategies: Strategy[];
}

/** Logbuch einer Position: oben neuer Eintrag, darunter die Einträge, neueste zuerst. */
export function TradeJournal({ trade, price, pnlPct, entries, strategies }: JournalProps) {
  // Strategien, in denen dieses Symbol vorkommt: die erste ist als Regel-Ziel vorgewählt
  const related = strategies.filter((s) => s.nodes.some((n) => n.symbol.trim().toUpperCase() === trade.symbol.toUpperCase()));
  const own = entries.filter((e) => e.tradeId === trade.id);

  return (
    <section className="jr" aria-label="Logbuch">
      <div className="jr-head">
        <span className="tm2-sub">Logbuch</span>
        {own.length > 0 && <span className="jr-count">{own.length}</span>}
      </div>
      <JournalComposer trade={{ id: trade.id, currency: trade.currency, price, pnlPct }} strategies={strategies} defaultStrategyId={related[0]?.id ?? null} onDone={() => undefined} />
      {own.length > 0 && (
        <ul className="jr-list">
          {own.map((e) => (
            <JournalEntryRow key={e.id} entry={e} strategies={strategies} />
          ))}
        </ul>
      )}
    </section>
  );
}
