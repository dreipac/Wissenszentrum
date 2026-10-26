import { AlertTriangle, CalendarX2, CalendarCheck, Clock, MapPin } from "lucide-react";
import { SecondaryButton } from "../ui/SecondaryButton";
import type { EventDeletion } from "../../lib/api/assistant";
import { whenOf } from "./ProposalCard";

/** Wie weit ein Löschvorschlag ist: offen, wird gerade gelöscht, gelöscht oder behalten. */
export type DeletionStatus = "open" | "deleting" | "deleted" | "dismissed";

export interface DeletionItem {
  key: number;
  data: EventDeletion;
  status: DeletionStatus;
  error?: string;
}

interface DeletionCardProps {
  item: DeletionItem;
  onDelete: () => void;
  onKeep: () => void;
}

/**
 * Löschvorschlag des Assistenten als Karte im Chat. Gelöscht wird erst nach „Löschen“; die Karte zeigt den Termin so,
 * dass man ihn sicher erkennt.
 */
export function DeletionCard({ item, onDelete, onKeep }: DeletionCardProps) {
  const { data, status, error } = item;
  const { date, time } = whenOf(data);
  const done = status === "deleted" || status === "dismissed";

  return (
    <article className={`as-proposal as-deletion ${status}`} aria-label={`Löschvorschlag: ${data.title}`}>
      <header className="as-prop-head">
        {status === "dismissed" ? <CalendarCheck size={14} /> : <CalendarX2 size={14} />}
        <span>{status === "deleted" ? "Gelöscht" : status === "dismissed" ? "Behalten" : "Löschen vorgeschlagen"}</span>
      </header>

      <h3 className="as-prop-title">{data.title}</h3>

      <ul className="as-prop-rows">
        <li>
          <Clock size={13} />
          <span>
            {date}
            <br />
            <span className="as-prop-muted">{time}</span>
          </span>
        </li>
        {data.location && (
          <li>
            <MapPin size={13} />
            <span>{data.location}</span>
          </li>
        )}
      </ul>

      {data.linkedTasks > 0 && !done && (
        <p className="as-prop-warn">
          <AlertTriangle size={13} />
          <span>
            {data.linkedTasks === 1 ? "Eine Aufgabe hängt" : `${data.linkedTasks} Aufgaben hängen`} an diesem Termin. Sie bleiben mit ihrem Datum bestehen.
          </span>
        </p>
      )}

      {error && <p className="as-prop-error">{error}</p>}

      {!done && (
        <div className="as-prop-actions">
          <SecondaryButton className="danger sm" disabled={status === "deleting"} onClick={onDelete}>
            {status === "deleting" ? "Lösche …" : "Termin löschen"}
          </SecondaryButton>
          <button type="button" className="as-prop-dismiss" disabled={status === "deleting"} onClick={onKeep}>
            Behalten
          </button>
        </div>
      )}
    </article>
  );
}
