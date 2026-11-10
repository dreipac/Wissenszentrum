// Datums-Helfer, übernommen aus der Desktop-App (src/lib/dates.ts).
// Zeitangaben werden als lokale Zeit "YYYY-MM-DD HH:MM" gespeichert. Wochen beginnen am Montag.

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

export const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const isSameMonth = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

/** 6 Wochen (42 Tage), beginnend mit dem Montag der Woche, in der der Monat startet. */
export function monthGrid(d: Date): Date[] {
  const start = startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Tage von a bis b (beide nach Mitternacht gerundet); negativ, wenn b vor a liegt. */
export const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("de-CH", opts);
const fMonthYear = fmt({ month: "long", year: "numeric" });
const fLongDay = fmt({ weekday: "long", day: "numeric", month: "long" });
const fDayMonth = fmt({ day: "numeric", month: "short" });
const fWeekdayShort = fmt({ weekday: "short" });

export const formatMonthYear = (d: Date) => fMonthYear.format(d);
export const formatLongDay = (d: Date) => fLongDay.format(d);
export const formatDayMonth = (d: Date) => fDayMonth.format(d).replace(".", "");
export const formatWeekdayShort = (d: Date) => fWeekdayShort.format(d).replace(".", "");

/** Wochentage in der Kopfzeile des Monats, Montag zuerst. */
export const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Datum der UTC-Zeit "YYYY-MM-DD HH:MM:SS" (wie in der Datenbank der Desktop-App) als lokales Datum. */
const parseUtc = (s: string) => new Date(s.replace(" ", "T") + "Z");

export const toUtcStr = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

/** „Gerade eben“, „vor 12 Min.“, „Heute, 09:12“, „Gestern“ oder „12. Okt.“ für eine UTC-Zeit. */
export function formatUpdated(utc: string, now = new Date()): string {
  const d = parseUtc(utc);
  const minutes = Math.round((now.getTime() - d.getTime()) / 60_000);
  if (minutes < 1) return "Gerade eben";
  if (minutes < 60) return `Vor ${minutes} Min.`;
  const days = daysBetween(d, now);
  if (days === 0) return `Heute, ${toTimeStr(d)}`;
  if (days === 1) return "Gestern";
  return formatDayMonth(d);
}
