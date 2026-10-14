import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin, Plus } from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { EventModal } from "../components/calendar/EventModal";
import { EventPreview, type PreviewTarget } from "../components/calendar/EventPreview";
import { MiniMonth } from "../components/calendar/MiniMonth";
import { MonthGrid } from "../components/calendar/MonthGrid";
import { TimeGrid } from "../components/calendar/TimeGrid";
import {
  eventsOnDay,
  formatTimeRange,
  type CalendarEvent,
  type EventDraft,
  type Selection,
  formatMinutes,
} from "../lib/calendar";
import {
  addDays,
  addMonths,
  formatLongDay,
  formatMonthYear,
  formatWeekRange,
  isoWeek,
  monthGrid,
  startOfDay,
  startOfWeek,
  toDateStr,
  toDateTimeStr,
  weekDays,
} from "../lib/dates";
import { useEvents } from "../lib/useEvents";
import "../components/calendar/Calendar.css";

type Mode = "day" | "workweek" | "week" | "month";

const MODES: { id: Mode; label: string }[] = [
  { id: "day", label: "Tag" },
  { id: "workweek", label: "Arbeitswoche" },
  { id: "week", label: "Woche" },
  { id: "month", label: "Monat" },
];

function shift(date: Date, mode: Mode, direction: 1 | -1): Date {
  if (mode === "month") return addMonths(date, direction);
  return addDays(date, direction * (mode === "day" ? 1 : 7));
}

/** Sichtbarer Zeitraum [from, to) als Datum-Strings. */
function visibleRange(date: Date, mode: Mode): [string, string] {
  let first: Date;
  let last: Date;
  if (mode === "month") {
    const grid = monthGrid(date);
    [first, last] = [grid[0], grid[41]];
  } else if (mode === "week" || mode === "workweek") {
    const days = weekDays(date);
    [first, last] = [days[0], days[mode === "week" ? 6 : 4]];
  } else {
    [first, last] = [date, date];
  }
  return [toDateTimeStr(startOfDay(first)), toDateTimeStr(addDays(startOfDay(last), 1))];
}

function draftFromSelection(sel: Selection): EventDraft {
  const day = toDateStr(sel.day);
  if (sel.allDay) return { allDay: true, startsAt: `${day} 00:00`, endsAt: `${day} 23:59` };
  // Ende 24:00 wird als 23:59 am selben Tag gespeichert
  const end = sel.endMin >= 24 * 60 ? "23:59" : formatMinutes(sel.endMin);
  return { startsAt: `${day} ${formatMinutes(sel.startMin)}`, endsAt: `${day} ${end}` };
}

export function CalendarView() {
  const today = useMemo(() => new Date(), []);
  const [mode, setMode] = useState<Mode>("month");
  // Datum plus Blätterrichtung (für die Animation) zusammen, damit beides atomar wechselt
  const [nav, setNav] = useState<{ date: Date; dir: "next" | "prev" | "fade" }>(() => ({
    date: startOfDay(new Date()),
    dir: "fade",
  }));
  const date = nav.date;
  const setDate = useCallback(
    (next: Date | ((d: Date) => Date)) =>
      setNav((prev) => {
        const d = typeof next === "function" ? next(prev.date) : next;
        return { date: d, dir: d > prev.date ? "next" : d < prev.date ? "prev" : prev.dir };
      }),
    [],
  );
  const changeMode = (m: Mode) => {
    setMode(m);
    setNav((prev) => ({ ...prev, dir: "fade" }));
  };
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);

  const [from, to] = visibleRange(date, mode);
  const { events, error, reload } = useEvents(from, to);

  // Auswahl und Vorschau gelten nur für die aktuell sichtbare Ansicht
  const dateKey = toDateStr(date);
  useEffect(() => {
    setSelection(null);
    setPreview(null);
  }, [mode, from, dateKey]);

  // Beim Blättern gleitet der Inhalt kurz herein (Web Animations API: bleibt ohne Neuaufbau, Scrollposition bleibt erhalten)
  const animRef = useRef<HTMLDivElement>(null);
  const lastPeriod = useRef<string | null>(null);
  const period =
    mode === "month"
      ? `month-${date.getFullYear()}-${date.getMonth()}`
      : mode === "day"
        ? `day-${dateKey}`
        : `${mode}-${toDateStr(startOfWeek(date))}`;
  useEffect(() => {
    const previous = lastPeriod.current;
    lastPeriod.current = period;
    if (previous === null || previous === period) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const offset = nav.dir === "next" ? "28px, 0" : nav.dir === "prev" ? "-28px, 0" : "0, 8px";
    animRef.current?.animate(
      [
        { opacity: 0, transform: `translate(${offset})` },
        { opacity: 1, transform: "none" },
      ],
      { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    // nur bei Wechsel des Zeitraums
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const closePreview = useCallback(() => setPreview(null), []);
  /** Einzelklick: Vorschau-Blase neben dem Termin, nichts wird blockiert. */
  const previewEvent = (event: CalendarEvent, el: HTMLElement) => {
    setSelection(null);
    setPreview({ event, rect: el.getBoundingClientRect() });
  };
  /** Doppelklick bzw. „Bearbeiten“: Dialog. */
  const openEvent = (event: CalendarEvent) => {
    setPreview(null);
    setDraft(event);
  };

  const title =
    mode === "month"
      ? formatMonthYear(date)
      : mode === "week"
        ? formatWeekRange(date)
        : mode === "workweek"
          ? formatWeekRange(date, 5)
          : formatLongDay(date);
  const subtitle = mode === "month" ? null : `KW ${isoWeek(date)}`;

  const openDay = (d: Date) => {
    setDate(startOfDay(d));
    changeMode("day");
  };
  const createOnDay = (d: Date) =>
    setDraft(draftFromSelection({ day: d, startMin: 9 * 60, endMin: 10 * 60, allDay: false }));
  /** Markierter Bereich → Dialog; ohne Auswahl 09:00–10:00 am gewählten Tag. */
  const createFromSelection = () => (selection ? setDraft(draftFromSelection(selection)) : createOnDay(date));

  // Enter erstellt aus der Auswahl, Escape hebt sie auf
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (draft || !selection) return;
      const target = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        setDraft(draftFromSelection(selection));
      } else if (e.key === "Escape") {
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, selection]);

  const agenda = eventsOnDay(events, date);

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title-row">
          <div className="cal-title-group">
            <h1 className="page-title cal-title">{title}</h1>
            {subtitle && <span className="cal-kw">{subtitle}</span>}
            <div className="cal-nav">
              <button type="button" className="icon-btn" aria-label="Zurück" onClick={() => setDate((d) => shift(d, mode, -1))}>
                <ChevronLeft size={18} />
              </button>
              <button type="button" className="icon-btn" aria-label="Weiter" onClick={() => setDate((d) => shift(d, mode, 1))}>
                <ChevronRight size={18} />
              </button>
            </div>
            <SecondaryButton className="sm" onClick={() => setDate(startOfDay(new Date()))}>
              Heute
            </SecondaryButton>
          </div>
          <div className="page-actions">
            <div className="segmented">
              {MODES.map((m) => (
                <button key={m.id} type="button" className={mode === m.id ? "active" : ""} onClick={() => changeMode(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
            <Button onClick={createFromSelection}>
              <Plus size={16} />
              Neuer Termin
            </Button>
          </div>
        </div>
        {error && <p className="field-error cal-error">Termine konnten nicht geladen werden: {error}</p>}
      </header>

      <div className="cal-layout">
        <div className="cal-main">
          <div className="cal-anim" ref={animRef}>
            {mode === "month" && (
              <MonthGrid
                date={date}
                today={today}
                events={events}
                onSelectDay={(d) => setDate(startOfDay(d))}
                onOpenDay={openDay}
                onCreate={createOnDay}
                onPreview={previewEvent}
                onOpenEvent={openEvent}
                activeEventId={preview?.event.id ?? null}
              />
            )}
            {mode !== "month" && (
              <TimeGrid
                key={mode}
                days={mode === "day" ? [date] : weekDays(date).slice(0, mode === "workweek" ? 5 : 7)}
                today={today}
                events={events}
                selection={selection}
                onSelect={setSelection}
                onCommit={createFromSelection}
                onOpenDay={openDay}
                onPreview={previewEvent}
                onOpenEvent={openEvent}
                activeEventId={preview?.event.id ?? null}
              />
            )}
          </div>
        </div>

        <aside className="cal-side">
          <MiniMonth date={date} today={today} onSelect={(d) => setDate(startOfDay(d))} />

          <div className="cal-side-section">
            <span className="card-title">{formatLongDay(date)}</span>
            {agenda.length === 0 ? (
              <p className="cal-empty">Keine Termine an diesem Tag.</p>
            ) : (
              <ul className="cal-agenda">
                {agenda.map((e: CalendarEvent) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      className={`card cal-agenda-item${preview?.event.id === e.id ? " active" : ""}`}
                      data-event-id={e.id}
                      onClick={(ev) => previewEvent(e, ev.currentTarget)}
                      onDoubleClick={() => openEvent(e)}
                    >
                      <span className="agenda-stripe" />
                      <span className="cal-agenda-text">
                        <span className="cal-agenda-title">{e.title}</span>
                        <span className="cal-agenda-meta">{formatTimeRange(e)}</span>
                        {e.location && (
                          <span className="cal-agenda-meta">
                            <MapPin size={11} /> {e.location}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <SecondaryButton className="cal-side-add" onClick={() => createOnDay(date)}>
              <Plus size={16} />
              Termin hinzufügen
            </SecondaryButton>
          </div>
        </aside>
      </div>

      {preview && !draft && <EventPreview key={preview.event.id} target={preview} onClose={closePreview} onEdit={openEvent} />}

      {draft && (
        <EventModal
          key={draft.id ?? "new"}
          draft={draft}
          onClose={() => setDraft(null)}
          onChanged={() => void reload()}
        />
      )}
    </div>
  );
}
