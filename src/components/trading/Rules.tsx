import { useMemo, useState } from "react";
import { Check, ListChecks } from "lucide-react";
import { ago, ruleText, type JournalEntry } from "../../lib/journal";
import { useJournal } from "../../lib/useJournal";
import { useStrategies } from "../../lib/useStrategies";
import "./Journal.css";

/** Regeln einer Strategie: „Besser machen“-Einträge, die ihr zugeordnet sind (neueste zuerst). */
export const rulesOf = (entries: JournalEntry[], strategyId: number) => entries.filter((e) => e.kind === "improve" && e.strategyId === strategyId);

interface ChecklistProps {
  /** Eingetipptes Symbol der neuen Position */
  symbol: string;
}

/**
 * Bei „Neue Position“: die Regeln aller Strategien, in denen dieses Symbol vorkommt, als Checkliste zum Abhaken
 * (nur zur Erinnerung, es wird nichts gespeichert).
 */
export function RulesChecklist({ symbol }: ChecklistProps) {
  const { entries } = useJournal();
  const { strategies } = useStrategies();
  const [done, setDone] = useState<Set<number>>(new Set());
  const typed = symbol.trim().toUpperCase();

  const groups = useMemo(() => {
    if (!typed) return [];
    return strategies
      .filter((s) => s.nodes.some((n) => n.symbol.trim().toUpperCase() === typed))
      .map((s) => ({ strategy: s, rules: rulesOf(entries, s.id) }))
      .filter((g) => g.rules.length > 0);
  }, [strategies, entries, typed]);

  if (groups.length === 0) return null;

  const toggle = (id: number) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="jr-checklist" aria-label="Regeln aus deinen Strategien">
      <h3>
        <ListChecks size={14} /> Regeln aus deinen Strategien
      </h3>
      {groups.map(({ strategy, rules }) => (
        <div key={strategy.id}>
          <span className="jr-checklist-strategy">{strategy.title}</span>
          <ul>
            {rules.map((r) => (
              <li key={r.id}>
                <button type="button" role="checkbox" aria-checked={done.has(r.id)} className={`jr-check${done.has(r.id) ? " done" : ""}`} onClick={() => toggle(r.id)}>
                  <span className="jr-check-box">{done.has(r.id) && <Check size={11} strokeWidth={3} />}</span>
                  <span>{ruleText(r)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** Schwebende Karte in der Strategie: die Regeln für das nächste Mal. Ohne Regeln erscheint nichts. */
export function StrategyRules({ strategyId }: { strategyId: number }) {
  const { entries } = useJournal();
  const [open, setOpen] = useState(false);
  const rules = rulesOf(entries, strategyId);
  if (rules.length === 0) return null;

  return (
    <div className={`strat-rules${open ? " open" : ""}`}>
      <button type="button" className="strat-rules-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ListChecks size={14} />
        Regeln fürs nächste Mal
        <span className="jr-count">{rules.length}</span>
      </button>
      {open && (
        <ul className="jr-rules">
          {rules.map((r) => (
            <li key={r.id}>
              <span>
                {ruleText(r)}
                <small>
                  {r.symbol} · {ago(r)}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
