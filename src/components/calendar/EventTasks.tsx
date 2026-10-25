import { ListTodo, Plus, X } from "lucide-react";
import { EventOffset } from "../tasks/EventOffset";
import { formatDayMonth, formatWeekdayShort, parseDateTime } from "../../lib/dates";
import { eventTaskDate, type Task } from "../../lib/tasks";
import "./EventTasks.css";

/** Aufgabe am Termin im Entwurf des Dialogs; `task` ist die gespeicherte Aufgabe, bei einer neuen null. */
export interface EventTaskDraft {
  key: number;
  task: Task | null;
  title: string;
  /** Abstand zum Termin in Tagen: negativ = davor, 0 = am Tag, positiv = danach */
  offset: number;
  done: boolean;
}

/** Eingabezeile für die nächste Aufgabe. */
export interface EventTaskAdder {
  title: string;
  offset: number;
}

interface EventTasksProps {
  items: EventTaskDraft[];
  onItems: (items: EventTaskDraft[]) => void;
  adder: EventTaskAdder;
  onAdder: (a: EventTaskAdder) => void;
  /** Beginn- und Enddatum des Termins (YYYY-MM-DD), aus denen sich die Daten der Aufgaben ergeben */
  startDate: string;
  endDate: string;
  onAdd: () => void;
}

const dateLabel = (iso: string) => {
  const d = parseDateTime(`${iso} 00:00`);
  return `${formatWeekdayShort(d)}, ${formatDayMonth(d)}`;
};

const progress = (items: EventTaskDraft[]) => ({ done: items.filter((i) => i.done).length, total: items.length });

/**
 * Aufgaben, die am Termin hängen: Vorbereitung davor, Nachbereitung danach. Ihre Fälligkeit ergibt sich aus dem
 * Abstand zum Termin und verschiebt sich mit ihm.
 */
export function EventTasks({ items, onItems, adder, onAdder, startDate, endDate, onAdd }: EventTasksProps) {
  const patch = (key: number, change: Partial<EventTaskDraft>) =>
    onItems(items.map((i) => (i.key === key ? { ...i, ...change } : i)));

  const dueOf = (offset: number) => (startDate && endDate ? eventTaskDate(`${startDate} 00:00`, `${endDate} 00:00`, offset) : null);

  const prep = progress(items.filter((i) => i.offset <= 0));
  const follow = progress(items.filter((i) => i.offset > 0));

  return (
    <div className="ev-row top">
      <ListTodo size={18} className="ev-icon" />
      <div className="ev-row-body">
        <div className="et-head">
          <span>Aufgaben zum Termin</span>
          {(prep.total > 0 || follow.total > 0) && (
            <span className="et-summary">
              {prep.total > 0 && `Vorbereitung ${prep.done}/${prep.total}`}
              {prep.total > 0 && follow.total > 0 && " · "}
              {follow.total > 0 && `Nachbereitung ${follow.done}/${follow.total}`}
            </span>
          )}
        </div>

        {items.length > 0 && (
          <ul className="et-list">
            {items.map((item) => {
              const due = dueOf(item.offset);
              return (
                <li key={item.key} className={`et-item${item.done ? " done" : ""}`}>
                  <button
                    type="button"
                    className={`check check-btn${item.done ? " checked" : ""}`}
                    role="checkbox"
                    aria-checked={item.done}
                    aria-label="Aufgabe abhaken"
                    onClick={() => patch(item.key, { done: !item.done })}
                  />
                  <input
                    className="et-title"
                    value={item.title}
                    aria-label="Aufgabe"
                    onChange={(e) => patch(item.key, { title: e.target.value })}
                  />
                  <EventOffset value={item.offset} onChange={(offset) => patch(item.key, { offset })} />
                  <span className="et-date">{due ? dateLabel(due) : ""}</span>
                  <button
                    type="button"
                    className="icon-btn et-remove"
                    aria-label="Vom Termin lösen"
                    title={item.task ? "Vom Termin lösen – die Aufgabe bleibt mit ihrem Datum bestehen" : "Entfernen"}
                    onClick={() => onItems(items.filter((i) => i.key !== item.key))}
                  >
                    <X size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className={`et-add${adder.title.trim() ? " active" : ""}`}>
          <Plus size={15} />
          <input
            value={adder.title}
            placeholder="Vor- oder Nachbereitung hinzufügen und Enter drücken"
            aria-label="Neue Aufgabe zum Termin"
            onChange={(e) => onAdder({ ...adder, title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Enter gehört der neuen Aufgabe, nicht dem Speichern des Termins
                e.stopPropagation();
                onAdd();
              }
            }}
          />
          <EventOffset value={adder.offset} onChange={(offset) => onAdder({ ...adder, offset })} ariaLabel="Abstand der neuen Aufgabe" />
          <span className="et-date">{dueOf(adder.offset) ? dateLabel(dueOf(adder.offset)!) : ""}</span>
          <span className="et-spacer" />
        </div>
      </div>
    </div>
  );
}
