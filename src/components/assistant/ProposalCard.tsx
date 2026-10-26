import { AlertTriangle, AlignLeft, CalendarCheck, CalendarPlus, CalendarX2, Clock, MapPin } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import type { EventProposal } from "../../lib/api/assistant";
import { formatLongDay, parseDateTime } from "../../lib/dates";

/** Wie weit ein Vorschlag ist: offen, wird gerade eingetragen, eingetragen oder verworfen. */
export type ProposalStatus = "open" | "creating" | "created" | "dismissed";

export interface ProposalItem {
  key: number;
  data: EventProposal;
  status: ProposalStatus;
  error?: string;
  /** Nummer des eingetragenen Termins, damit er sich im Kalender zeigen lässt (unbekannt nach „Bearbeiten“) */
  eventId?: number;
}

interface ProposalCardProps {
  item: ProposalItem;
  onCreate: () => void;
  onEdit: () => void;
  onDismiss: () => void;
  onShow: () => void;
}

/** Datum und Zeit eines Termins für die Anzeige. */
export function whenOf(p: Pick<EventProposal, "startsAt" | "endsAt" | "allDay">): { date: string; time: string } {
  const start = parseDateTime(p.startsAt);
  const sameDay = p.startsAt.slice(0, 10) === p.endsAt.slice(0, 10);
  const date = sameDay ? formatLongDay(start) : `${formatLongDay(start)} – ${formatLongDay(parseDateTime(p.endsAt))}`;
  return { date, time: p.allDay ? "Ganztägig" : `${p.startsAt.slice(11)} – ${p.endsAt.slice(11)}` };
}

/**
 * Terminvorschlag des Assistenten als Karte im Chat. Eingetragen wird erst nach „Anlegen“; „Bearbeiten“ öffnet den
 * üblichen Termin-Dialog mit den vorgeschlagenen Angaben.
 */
export function ProposalCard({ item, onCreate, onEdit, onDismiss, onShow }: ProposalCardProps) {
  const { data, status, error } = item;
  const { date, time } = whenOf(data);
  const done = status === "created" || status === "dismissed";

  return (
    <article className={`as-proposal ${status}`} aria-label={`Terminvorschlag: ${data.title}`}>
      <header className="as-prop-head">
        {status === "created" ? <CalendarCheck size={14} /> : status === "dismissed" ? <CalendarX2 size={14} /> : <CalendarPlus size={14} />}
        <span>{status === "created" ? "Eingetragen" : status === "dismissed" ? "Verworfen" : "Terminvorschlag"}</span>
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
        {data.description && !done && (
          <li>
            <AlignLeft size={13} />
            <span className="as-prop-desc">{data.description}</span>
          </li>
        )}
      </ul>

      {data.conflicts.length > 0 && !done && (
        <p className="as-prop-warn">
          <AlertTriangle size={13} />
          <span>Überschneidet sich mit {data.conflicts.join(", ")}</span>
        </p>
      )}

      {error && <p className="as-prop-error">{error}</p>}

      {!done && (
        <div className="as-prop-actions">
          <Button className="sm" disabled={status === "creating"} onClick={onCreate}>
            {status === "creating" ? "Trage ein …" : "Anlegen"}
          </Button>
          <SecondaryButton className="sm" disabled={status === "creating"} onClick={onEdit}>
            Bearbeiten
          </SecondaryButton>
          <button type="button" className="as-prop-dismiss" disabled={status === "creating"} onClick={onDismiss}>
            Verwerfen
          </button>
        </div>
      )}

      {status === "created" && (
        <button type="button" className="as-prop-link" onClick={onShow}>
          Im Kalender zeigen
        </button>
      )}
    </article>
  );
}
