import { addDays, parseDateTime, startOfDay, toDateTimeStr } from "./dates";

export interface CalendarEvent {
  id: number;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

export type EventInput = Omit<CalendarEvent, "id">;

/** Vorbelegung für den Dialog – mit `id` wird ein bestehender Termin bearbeitet. */
export type EventDraft = Partial<CalendarEvent> & Pick<EventInput, "startsAt" | "endsAt">;

/** Markierter Bereich im Zeitraster (30-Minuten-Takt) oder ein ganzer Tag (Ganztägig-Zeile). */
export interface Selection {
  day: Date;
  startMin: number; // Minuten ab 00:00
  endMin: number; // exklusiv, max. 1440
  allDay: boolean;
}

export const SNAP_MINUTES = 30;

export const formatMinutes = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const HOUR_HEIGHT = 52;

/** Termine, die den Kalendertag berühren (auch mehrtägige). */
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const from = toDateTimeStr(startOfDay(day));
  const to = toDateTimeStr(addDays(startOfDay(day), 1));
  return events.filter((e) => e.startsAt < to && e.endsAt > from);
}

export interface PositionedEvent {
  event: CalendarEvent;
  top: number; // Minuten ab 00:00
  height: number; // Minuten
  col: number;
  cols: number;
}

const MIN_VISUAL_MINUTES = 30;

/** Ordnet zeitgebundene Termine eines Tages nebeneinander an, damit sich Überschneidungen nicht verdecken. */
export function layoutDay(events: CalendarEvent[], day: Date): PositionedEvent[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();

  const items = eventsOnDay(events, day)
    .filter((e) => !e.allDay)
    .map((event) => {
      const s = Math.max(parseDateTime(event.startsAt).getTime(), dayStart);
      const e = Math.min(parseDateTime(event.endsAt).getTime(), dayEnd);
      const top = Math.round((s - dayStart) / 60000);
      const height = Math.max(Math.round((e - s) / 60000), MIN_VISUAL_MINUTES);
      return { event, top, height, col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  const result: PositionedEvent[] = [];
  let cluster: PositionedEvent[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    cluster.forEach((i) => (i.cols = colEnds.length));
    result.push(...cluster);
    cluster = [];
    colEnds = [];
  };

  for (const item of items) {
    if (cluster.length && item.top >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= item.top);
    if (col === -1) col = colEnds.length;
    colEnds[col] = item.top + item.height;
    item.col = col;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.top + item.height);
  }
  flush();
  return result;
}

export const formatTimeRange = (e: CalendarEvent) =>
  e.allDay ? "Ganztägig" : `${e.startsAt.slice(11)} – ${e.endsAt.slice(11)}`;
