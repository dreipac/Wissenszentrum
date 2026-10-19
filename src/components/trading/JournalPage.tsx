import { useMemo, useState } from "react";
import { NotebookPen } from "lucide-react";
import { KINDS, KIND_LABEL, TOPICS, TOPIC_LABEL, type JournalKind, type JournalTopic } from "../../lib/journal";
import { useJournal } from "../../lib/useJournal";
import { useStrategies } from "../../lib/useStrategies";
import { JournalEntryRow } from "./Journal";
import "./Journal.css";

interface JournalPageProps {
  onOpenTrade: (id: number) => void;
}

/** Tab „Logbuch“: alle Einträge aller Positionen, filterbar nach Art und Thema – dazu die häufigsten Fehlerthemen. */
export function JournalPage({ onOpenTrade }: JournalPageProps) {
  const { entries, loaded } = useJournal();
  const { strategies } = useStrategies();
  const [kind, setKind] = useState<JournalKind | "all">("all");
  const [topic, setTopic] = useState<JournalTopic | "all">("all");

  const byKind = useMemo(() => KINDS.map((k) => ({ k, n: entries.filter((e) => e.kind === k).length })), [entries]);
  // Muster: Themen, die in Fehlern und „Besser machen“ am häufigsten vorkommen
  const patterns = useMemo(() => {
    const counts = new Map<JournalTopic, number>();
    for (const e of entries) if ((e.kind === "mistake" || e.kind === "improve") && e.topic) counts.set(e.topic, (counts.get(e.topic) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);
  const topicCounts = useMemo(() => TOPICS.map((t) => ({ t, n: entries.filter((e) => e.topic === t && (kind === "all" || e.kind === kind)).length })).filter((x) => x.n > 0), [entries, kind]);
  const visible = entries.filter((e) => (kind === "all" || e.kind === kind) && (topic === "all" || e.topic === topic));
  const maxPattern = patterns[0]?.[1] ?? 1;

  if (loaded && entries.length === 0) {
    return (
      <div className="card tr-empty-state">
        <NotebookPen size={28} />
        <h3>Noch keine Einträge</h3>
        <p>Öffne eine Position und schreibe im Logbuch auf, was dir auffällt, was schiefläuft und was du besser machen willst. Hier sammelt sich alles an einem Ort.</p>
      </div>
    );
  }

  return (
    <div className="jr-page">
      <section className="card">
        <ul className="jr-list">
          {visible.length === 0 ? (
            <li className="muted tr-list-empty">Keine Einträge für diese Auswahl.</li>
          ) : (
            visible.map((e) => <JournalEntryRow key={e.id} entry={e} strategies={strategies} showTrade onOpenTrade={onOpenTrade} />)
          )}
        </ul>
      </section>

      <aside className="jr-filters card">
        <div className="jr-filter-group">
          <h3>Art</h3>
          <button type="button" className={`jr-filter${kind === "all" ? " active" : ""}`} onClick={() => setKind("all")}>
            <span>Alle</span>
            <span>{entries.length}</span>
          </button>
          {byKind.map(({ k, n }) => (
            <button key={k} type="button" className={`jr-filter${kind === k ? " active" : ""}`} onClick={() => setKind(k)}>
              <span>{KIND_LABEL[k]}</span>
              <span>{n}</span>
            </button>
          ))}
        </div>

        {topicCounts.length > 0 && (
          <div className="jr-filter-group">
            <h3>Thema</h3>
            <button type="button" className={`jr-filter${topic === "all" ? " active" : ""}`} onClick={() => setTopic("all")}>
              <span>Alle</span>
            </button>
            {topicCounts.map(({ t, n }) => (
              <button key={t} type="button" className={`jr-filter${topic === t ? " active" : ""}`} onClick={() => setTopic(t)}>
                <span>{TOPIC_LABEL[t]}</span>
                <span>{n}</span>
              </button>
            ))}
          </div>
        )}

        {patterns.length > 0 && (
          <div className="jr-filter-group">
            <h3>Häufigste Fehlerthemen</h3>
            {patterns.slice(0, 4).map(([t, n]) => (
              <div key={t} className="jr-pattern">
                <span>{TOPIC_LABEL[t as Exclude<JournalTopic, "">]}</span>
                <span className="jr-pattern-bar">
                  <i style={{ width: `${(n / maxPattern) * 100}%` }} />
                </span>
                <span>{n}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
