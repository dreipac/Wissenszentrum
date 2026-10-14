import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { ContextMenu } from "../ui/ContextMenu";
import {
  HOUR_HEIGHT,
  SNAP_MINUTES,
  eventsOnDay,
  formatMinutes,
  layoutDay,
  type CalendarEvent,
  type Selection,
} from "../../lib/calendar";
import { formatWeekdayShort, isSameDay } from "../../lib/dates";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SLOTS_PER_DAY = (24 * 60) / SNAP_MINUTES;
const SLOT_HEIGHT = (HOUR_HEIGHT * SNAP_MINUTES) / 60;

/** Slot-Index (0–47) an einer Mausposition innerhalb einer Tagesspalte. */
const slotAt = (column: HTMLElement, clientY: number) => {
  const y = clientY - column.getBoundingClientRect().top;
  return Math.min(Math.max(Math.floor(y / SLOT_HEIGHT), 0), SLOTS_PER_DAY - 1);
};

interface TimeGridProps {
  days: Date[];
  today: Date;
  events: CalendarEvent[];
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  /** Aus der Auswahl einen Termin erstellen (Doppelklick, „+“-Button). */
  onCommit: () => void;
  onOpenDay: (d: Date) => void;
  /** Einzelklick auf einen Termin: Vorschau-Blase. */
  onPreview: (e: CalendarEvent, el: HTMLElement) => void;
  /** Doppelklick auf einen Termin: Bearbeiten-Dialog. */
  onOpenEvent: (e: CalendarEvent) => void;
  activeEventId: number | null;
}

interface Drag {
  day: Date;
  column: HTMLElement;
  anchor: number; // Slot-Index, bei dem das Ziehen begann
}

export function TimeGrid({ days, today, events, selection, onSelect, onCommit, onOpenDay, onPreview, onOpenEvent, activeEventId }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());

  // Aktuelle Callback-Version für die window-Listener beim Ziehen
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const drag = useRef<Drag | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Beim Öffnen zum Arbeitstag scrollen (bzw. zur aktuellen Uhrzeit, wenn heute sichtbar ist).
  useEffect(() => {
    const todayVisible = days.some((d) => isSameDay(d, new Date()));
    const hour = todayVisible ? Math.max(0, new Date().getHours() - 2) : 7;
    if (scrollRef.current) scrollRef.current.scrollTop = hour * HOUR_HEIGHT;
    // nur beim Einblenden der Ansicht
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ziehen: Auswahl wächst mit der Maus, bis die Taste losgelassen wird.
  useEffect(() => {
    const toSelection = (d: Drag, slot: number): Selection => ({
      day: d.day,
      startMin: Math.min(d.anchor, slot) * SNAP_MINUTES,
      endMin: (Math.max(d.anchor, slot) + 1) * SNAP_MINUTES,
      allDay: false,
    });

    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      onSelectRef.current(toSelection(drag.current, slotAt(drag.current.column, e.clientY)));
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = (e: React.MouseEvent<HTMLDivElement>, day: Date) => {
    if (e.button !== 0) return;
    const column = e.currentTarget;
    const anchor = slotAt(column, e.clientY);
    drag.current = { day, column, anchor };
    onSelect({
      day,
      startMin: anchor * SNAP_MINUTES,
      endMin: (anchor + 1) * SNAP_MINUTES,
      allDay: false,
    });
  };

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const onColumnContextMenu = (e: React.MouseEvent<HTMLDivElement>, day: Date) => {
    const min = slotAt(e.currentTarget, e.clientY) * SNAP_MINUTES;
    const inside =
      selection && !selection.allDay && isSameDay(selection.day, day) && min >= selection.startMin && min < selection.endMin;
    if (!inside) onSelect({ day, startMin: min, endMin: min + SNAP_MINUTES, allDay: false });
    openMenu(e);
  };

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="tg" onContextMenu={(e) => e.preventDefault()} style={{ "--n": days.length, "--hh": `${HOUR_HEIGHT}px` } as React.CSSProperties}>
      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-sticky">
          <div className="tg-cols tg-head">
            <span />
            {days.map((d) => (
              <button
                key={d.getTime()}
                type="button"
                className={`tg-head-day${isSameDay(d, today) ? " today" : ""}`}
                onClick={() => onOpenDay(d)}
              >
                <span className="tg-head-wd">{formatWeekdayShort(d)}</span>
                <span className="tg-head-num">{d.getDate()}</span>
              </button>
            ))}
          </div>

          <div className="tg-cols tg-allday">
            <span className="tg-allday-label">Ganztägig</span>
            {days.map((d) => {
              const selected = selection?.allDay && isSameDay(selection.day, d);
              return (
                <div
                  key={d.getTime()}
                  className={`tg-allday-cell${selected ? " selected" : ""}`}
                  onClick={() => onSelect({ day: d, startMin: 0, endMin: 24 * 60, allDay: true })}
                  onDoubleClick={onCommit}
                  onContextMenu={(e) => {
                    onSelect({ day: d, startMin: 0, endMin: 24 * 60, allDay: true });
                    openMenu(e);
                  }}
                >
                  {eventsOnDay(events, d)
                    .filter((e) => e.allDay)
                    .map((e) => (
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
                        {e.title}
                      </button>
                    ))}
                  {selected && (
                    <button
                      type="button"
                      className="tg-add"
                      aria-label="Termin erstellen"
                      title="Termin erstellen"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onCommit();
                      }}
                    >
                      <Plus size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="tg-cols tg-body" style={{ height: 24 * HOUR_HEIGHT }}>
          <div className="tg-hours">
            {HOURS.slice(1).map((h) => (
              <span key={h} style={{ top: h * HOUR_HEIGHT }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {days.map((d) => {
            const isToday = isSameDay(d, today);
            const sel = selection && !selection.allDay && isSameDay(selection.day, d) ? selection : null;
            return (
              <div
                key={d.getTime()}
                className={`tg-col${isToday ? " today" : ""}`}
                onMouseDown={(e) => startDrag(e, d)}
                onContextMenu={(e) => onColumnContextMenu(e, d)}
                onDoubleClick={() => sel && onCommit()}
              >
                {sel && (
                  <div
                    className="tg-selection"
                    style={{
                      top: (sel.startMin / 60) * HOUR_HEIGHT,
                      height: ((sel.endMin - sel.startMin) / 60) * HOUR_HEIGHT - 1,
                    }}
                  >
                    <span className="tg-selection-time">
                      {formatMinutes(sel.startMin)} – {formatMinutes(sel.endMin)}
                    </span>
                    <button
                      type="button"
                      className="tg-add"
                      aria-label="Termin erstellen"
                      title="Termin erstellen"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={onCommit}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                )}

                {layoutDay(events, d).map(({ event, top, height, col, cols }) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`tg-event${activeEventId === event.id ? " active" : ""}`}
                    data-event-id={event.id}
                    style={
                      {
                        top: (top / 60) * HOUR_HEIGHT,
                        height: (height / 60) * HOUR_HEIGHT - 2,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${100 / cols}% - 4px)`,
                      } as React.CSSProperties
                    }
                    onMouseDown={(ev) => ev.stopPropagation()}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                    }}
                    onDoubleClick={(ev) => {
                      ev.stopPropagation();
                      onOpenEvent(event);
                    }}
                    onClick={(ev) => onPreview(event, ev.currentTarget)}
                  >
                    <span className="tg-event-title">{event.title}</span>
                    {height >= 45 && (
                      <span className="tg-event-time">
                        {event.startsAt.slice(11)} – {event.endsAt.slice(11)}
                      </span>
                    )}
                  </button>
                ))}
                {isToday && <div className="tg-now" style={{ top: (nowMinutes / 60) * HOUR_HEIGHT }} />}
              </div>
            );
          })}
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: "Termin eintragen", icon: Plus, onClick: onCommit }]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
