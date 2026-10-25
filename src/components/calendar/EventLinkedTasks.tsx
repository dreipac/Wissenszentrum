import { ListTodo } from "lucide-react";
import { setTaskDone } from "../../lib/api/tasks";
import { taskProgressLabel, type CalendarEvent } from "../../lib/calendar";
import { formatEventOffset, type Task } from "../../lib/tasks";

/** Kleine Marke „3/5“ am Termin: so weit sind seine Aufgaben. Nichts, wenn keine daran hängen. */
export function TaskBadge({ event }: { event: CalendarEvent }) {
  const label = taskProgressLabel(event);
  if (!label) return null;
  const total = event.prepTotal + event.followTotal;
  const done = event.prepDone + event.followDone;
  return (
    <small className={`ev-badge${done === total ? " complete" : ""}`} title={`Aufgaben am Termin: ${done} von ${total} erledigt`}>
      <ListTodo size={10} />
      {label}
    </small>
  );
}

const MAX_SHOWN = 6;

interface EventLinkedTasksProps {
  event: CalendarEvent;
  /** Alle Aufgaben; die des Termins werden herausgesucht */
  tasks: Task[];
  /** Klassenpräfix der umgebenden Zeilen (Vorschau oder Details) */
  rowClass: string;
}

/** Aufgaben am Termin mit Fortschritt – direkt abhakbar. Vorbereitung steht vor, Nachbereitung hinter dem Termin. */
export function EventLinkedTasks({ event, tasks, rowClass }: EventLinkedTasksProps) {
  const mine = tasks
    .filter((t) => t.eventId === event.id && t.eventOffset !== null)
    .sort((a, b) => a.eventOffset! - b.eventOffset! || a.id - b.id);
  if (mine.length === 0) return null;

  const parts: string[] = [];
  if (event.prepTotal > 0) parts.push(`Vorbereitung ${event.prepDone}/${event.prepTotal}`);
  if (event.followTotal > 0) parts.push(`Nachbereitung ${event.followDone}/${event.followTotal}`);

  return (
    <div className={rowClass}>
      <ListTodo size={14} />
      <div className="elt">
        <span className="elt-summary">{parts.join(" · ")}</span>
        <ul className="elt-list">
          {mine.slice(0, MAX_SHOWN).map((t) => (
            <li key={t.id} className={t.done ? "done" : ""}>
              <button
                type="button"
                className={`check check-btn sm${t.done ? " checked" : ""}`}
                role="checkbox"
                aria-checked={t.done}
                aria-label={`„${t.title}“ ${t.done ? "als offen markieren" : "abhaken"}`}
                onClick={() => void setTaskDone(t.id, !t.done)}
              />
              <span className="elt-title strike">{t.title}</span>
              <span className="elt-offset">{formatEventOffset(t.eventOffset!)}</span>
            </li>
          ))}
        </ul>
        {mine.length > MAX_SHOWN && <span className="elt-more">+{mine.length - MAX_SHOWN} weitere</span>}
      </div>
    </div>
  );
}
