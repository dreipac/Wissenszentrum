// Datums-Helfer. Zeitangaben werden als lokale Zeit "YYYY-MM-DD HH:MM" gespeichert.
// Wochen beginnen am Montag.

const pad = (n: number) => String(n).padStart(2, "0");

export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toTimeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const toDateTimeStr = (d: Date) => `${toDateStr(d)} ${toTimeStr(d)}`;

export function parseDateTime(s: string): Date {
  const [date, time = "00:00"] = s.split(" ");
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
}

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

/** Monate addieren, ohne in den Folgemonat zu rutschen (31. Jan + 1 Monat = 28./29. Feb). */
export function addMonths(d: Date, n: number): Date {
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay));
}

export const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const isSameMonth = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** ISO-8601-Kalenderwoche. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** 6 Wochen (42 Tage), beginnend mit dem Montag der Woche, in der der Monat startet. */
export function monthGrid(d: Date): Date[] {
  const start = startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export const weekDays = (d: Date): Date[] => {
  const start = startOfWeek(d);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
};

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("de-DE", opts);
const fMonthYear = fmt({ month: "long", year: "numeric" });
const fLongDay = fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fDayMonth = fmt({ day: "numeric", month: "short" });
const fMonthShort = fmt({ month: "short" });
const fWeekdayShort = fmt({ weekday: "short" });
const fMonthLong = fmt({ month: "long" });

export const formatMonthYear = (d: Date) => fMonthYear.format(d);
export const formatLongDay = (d: Date) => fLongDay.format(d);
export const formatDayMonth = (d: Date) => fDayMonth.format(d);
export const formatMonthLong = (d: Date) => fMonthLong.format(d);
export const formatWeekdayShort = (d: Date) => fWeekdayShort.format(d).replace(".", "");

/** Zeitraum einer Woche; `length` 5 = Arbeitswoche (Mo–Fr), 7 = ganze Woche. */
export function formatWeekRange(d: Date, length = 7): string {
  const days = weekDays(d);
  const a = days[0];
  const b = days[length - 1];
  if (isSameMonth(a, b)) {
    return `${a.getDate()}.–${b.getDate()}. ${fMonthShort.format(b)} ${b.getFullYear()}`;
  }
  if (a.getFullYear() === b.getFullYear()) {
    return `${fDayMonth.format(a)} – ${fDayMonth.format(b)} ${b.getFullYear()}`;
  }
  return `${fDayMonth.format(a)} ${a.getFullYear()} – ${fDayMonth.format(b)} ${b.getFullYear()}`;
}
