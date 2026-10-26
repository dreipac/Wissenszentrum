import { Check, FolderKanban } from "lucide-react";
import type { BucketChoice } from "../../lib/api/assistant";

export interface BucketChoiceItem {
  key: number;
  data: BucketChoice;
  /** Name des gewählten Buckets („Ohne Bucket“ inklusive); solange nichts gewählt ist, offen */
  chosen?: string;
}

interface BucketChoiceCardProps {
  item: BucketChoiceItem;
  /** Nur die letzte Auswahl im Chat lässt sich noch anklicken, und nicht während der Assistent arbeitet */
  disabled: boolean;
  onChoose: (name: string | null) => void;
}

const NONE = "Ohne Bucket";

/**
 * Auswahl des Buckets für eine neue Aufgabe als Karte im Chat. Ein Klick sendet die Wahl als Nachricht,
 * danach schlägt der Assistent die Aufgabe vor.
 */
export function BucketChoiceCard({ item, disabled, onChoose }: BucketChoiceCardProps) {
  const { data, chosen } = item;
  const locked = disabled || chosen !== undefined;

  return (
    <section className={`as-proposal as-choice${chosen !== undefined ? " answered" : ""}`} aria-label="Bucket wählen">
      <header className="as-prop-head">
        {chosen !== undefined ? <Check size={14} /> : <FolderKanban size={14} />}
        <span>{chosen !== undefined ? "Bucket gewählt" : "Bucket wählen"}</span>
      </header>
      {data.taskTitle && <h3 className="as-prop-title">{data.taskTitle}</h3>}

      <div className="as-buckets" role="group" aria-label="Buckets">
        {data.buckets.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`as-bucket${chosen === b.name ? " picked" : ""}`}
            disabled={locked}
            onClick={() => onChoose(b.name)}
          >
            <i className="as-dot" style={b.color ? { backgroundColor: `var(--bucket-${b.color})` } : undefined} />
            <span className="as-bucket-name">{b.name}</span>
            <span className="as-bucket-count">{b.openTasks === 0 ? "leer" : `${b.openTasks} offen`}</span>
          </button>
        ))}
        <button type="button" className={`as-bucket none${chosen === NONE ? " picked" : ""}`} disabled={locked} onClick={() => onChoose(null)}>
          <i className="as-dot empty" />
          <span className="as-bucket-name">{NONE}</span>
        </button>
      </div>
    </section>
  );
}

export { NONE as NO_BUCKET };
