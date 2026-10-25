import { Plus } from "lucide-react";
import { eventsOnDay, type CalendarEvent } from "../../lib/calendar";
import { isSameDay, isSameMonth, monthGrid } from "../../lib/dates";
import { TaskBadge } from "./EventLinkedTasks";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MAX_CHIPS = 3;

interface MonthGridProps {
  date: Date;
  today: Date;
  events: CalendarEvent[];
  onSelectDay: (d: Date) => void;
  onOpenDay: (d: Date) => void;
  onCreate: (d: Date) => void;
  onPreview: (e: CalendarEvent, el: HTMLElement) => void;
  onOpenEvent: (e: CalendarEvent) => void;
  activeEventId: number | null;
}

export function MonthGrid({ date, today, events, onSelectDay, onOpenDay, onCreate, onPreview, onOpenEvent, activeEventId }: MonthGridProps) {
  const cells = monthGrid(date);

  return (
    <div className="month">
      <div className="month-weekdays">
        {WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="month-grid">
        {cells.map((day) => {
          const inMonth = isSameMonth(day, date);
          const dayEvents = eventsOnDay(events, day);
          const hidden = dayEvents.length - MAX_CHIPS;
          const cls = [
            "month-cell",
            inMonth ? "" : "outside",
            isSameDay(day, today) ? "today" : "",
            isSameDay(day, date) ? "selected" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={day.getTime()}
              className={cls}
              onClick={() => onSelectDay(day)}
              onDoubleClick={() => onOpenDay(day)}
            >
              <div className="month-cell-top">
                <span className="month-day">{day.getDate()}</span>
                <button
                  type="button"
                  className="month-add"
                  aria-label="Termin hinzufügen"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreate(day);
                  }}
                >
                  <Plus size={13} />
                </button>
              </div>
              <div className="month-events">
                {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`chip${activeEventId === e.id ? " active" : ""}`}
                    data-event-id={e.id}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onPreview(e, ev.currentTarget);
                    }}
                    onDoubleClick={(ev) => {
                      ev.stopPropagation();
                      onOpenEvent(e);
                    }}
                  >
                    <TaskBadge event={e} />
                    {!e.allDay && <em>{e.startsAt.slice(11)}</em>}
                    {e.title}
                  </button>
                ))}
                {hidden > 0 && <span className="month-more">+{hidden} weitere</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
