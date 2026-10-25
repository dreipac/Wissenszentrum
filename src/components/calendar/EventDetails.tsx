import { AlignLeft, Clock, MapPin, X } from "lucide-react";
import { SecondaryButton } from "../ui/SecondaryButton";
import { formatTimeRange, type CalendarEvent } from "../../lib/calendar";
import { formatLongDay, parseDateTime } from "../../lib/dates";
import { useTasks } from "../../lib/useTasks";
import { EventLinkedTasks } from "./EventLinkedTasks";

interface EventDetailsProps {
  event: CalendarEvent;
  onEdit: (e: CalendarEvent) => void;
  onClose: () => void;
}

/** Details des ausgewählten Termins in der Seitenleiste, unter dem Mini-Kalender. */
export function EventDetails({ event, onEdit, onClose }: EventDetailsProps) {
  const { tasks } = useTasks();
  const start = parseDateTime(event.startsAt);
  const sameDay = event.startsAt.slice(0, 10) === event.endsAt.slice(0, 10);
  const dateLine = sameDay ? formatLongDay(start) : `${formatLongDay(start)} – ${formatLongDay(parseDateTime(event.endsAt))}`;

  return (
    <section className="card event-details" aria-label={`Details: ${event.title}`}>
      <header className="event-details-head">
        <span className="event-details-bar" />
        <h3 className="event-details-title">{event.title}</h3>
        <button type="button" className="icon-btn" aria-label="Auswahl aufheben" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="event-details-rows">
        <div className="event-details-row">
          <Clock size={14} />
          <span>
            {dateLine}
            <br />
            <span className="muted">{formatTimeRange(event)}</span>
          </span>
        </div>
        {event.location && (
          <div className="event-details-row">
            <MapPin size={14} />
            <span>{event.location}</span>
          </div>
        )}
        {event.description && (
          <div className="event-details-row">
            <AlignLeft size={14} />
            <span className="event-details-desc">{event.description}</span>
          </div>
        )}
        <EventLinkedTasks event={event} tasks={tasks} rowClass="event-details-row" />
      </div>

      <SecondaryButton className="sm event-details-edit" onClick={() => onEdit(event)}>
        Bearbeiten
      </SecondaryButton>
    </section>
  );
}
