import type { CalendarEvent } from "@/data/types";
import { addDays, daysBetween, formatWeekdayShort, parseDateTime, startOfDay, toDateTimeStr, toTimeStr } from "./dates";

/** „Heute“, „Morgen“ oder „Mi, 12.11.“ */
export function dayName(day: Date, now = new Date()): string {
  const diff = daysBetween(now, day);
  if (diff <= 0) return "Heute";
  if (diff === 1) return "Morgen";
  return `${formatWeekdayShort(day)}, ${day.getDate()}.${day.getMonth() + 1}.`;
}

/** Wie lange es bis zum Beginn dauert: „Jetzt“, „in 25 Min.“, „in 2 Std.“; an späteren Tagen der Tag („Morgen“, „Mi, 12.11.“). */
export function relativeStart(e: CalendarEvent, now = new Date()): string {
  const start = parseDateTime(e.startsAt);
  if (e.allDay) return dayName(start, now);
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "Jetzt";
  if (minutes < 60) return `in ${minutes} Min.`;
  if (daysBetween(now, start) === 0) return `in ${Math.round(minutes / 60)} Std.`;
  return dayName(start, now);
}

/** Termine, die den Kalendertag berühren (auch mehrtägige), ganztägige zuerst, dann nach Beginn. */
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const from = toDateTimeStr(startOfDay(day));
  const to = toDateTimeStr(addDays(startOfDay(day), 1));
  return events.filter((e) => e.startsAt < to && e.endsAt > from).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt));
}

/** „09:30 – 10:30“ oder „Ganztägig“. */
export function formatTimeRange(e: CalendarEvent): string {
  return e.allDay ? "Ganztägig" : `${toTimeStr(parseDateTime(e.startsAt))} – ${toTimeStr(parseDateTime(e.endsAt))}`;
}

/** Nächste Termine ab jetzt (laufende zählen mit), höchstens `days` Tage voraus. */
export function upcomingEvents(events: CalendarEvent[], now = new Date(), days = 7): CalendarEvent[] {
  const from = toDateTimeStr(now);
  const to = toDateTimeStr(addDays(startOfDay(now), days));
  return events.filter((e) => e.endsAt > from && e.startsAt < to).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
