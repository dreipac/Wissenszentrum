import type { ChatInfo } from "./api/chats";

/** Ein Abschnitt der Chat-Liste, zum Beispiel „Heute“. */
export interface ChatGroup {
  key: string;
  label: string;
  chats: ChatInfo[];
}

/** `YYYY-MM-DD HH:MM:SS` (UTC) als Datum. */
export function parseUtc(value: string): Date {
  return new Date(`${value.replace(" ", "T")}Z`);
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Wie viele Kalendertage zwischen dem Chat und heute liegen (0 = heute). */
export function daysAgo(updatedAt: string, now: Date = new Date()): number {
  const days = (startOfDay(now).getTime() - startOfDay(parseUtc(updatedAt)).getTime()) / 86_400_000;
  return Math.max(0, Math.round(days));
}

/** Gliedert Chats ohne Projekt nach ihrer letzten Benutzung: Heute, Gestern, die letzten 7 Tage, die letzten 30 Tage, älter. */
export function groupByAge(chats: ChatInfo[], now: Date = new Date()): ChatGroup[] {
  const defs: { key: string; label: string; test: (days: number) => boolean }[] = [
    { key: "today", label: "Heute", test: (d) => d === 0 },
    { key: "yesterday", label: "Gestern", test: (d) => d === 1 },
    { key: "week", label: "Letzte 7 Tage", test: (d) => d >= 2 && d <= 7 },
    { key: "month", label: "Letzte 30 Tage", test: (d) => d >= 8 && d <= 30 },
    { key: "older", label: "Älter", test: (d) => d > 30 },
  ];
  return defs
    .map((def) => ({ key: def.key, label: def.label, chats: chats.filter((c) => def.test(daysAgo(c.updatedAt, now))) }))
    .filter((g) => g.chats.length > 0);
}

/** Kurze Zeitangabe für die Liste: Uhrzeit heute, sonst „Gestern“, der Wochentag oder das Datum. */
export function shortWhen(updatedAt: string, now: Date = new Date()): string {
  const date = parseUtc(updatedAt);
  const days = daysAgo(updatedAt, now);
  if (days === 0) return date.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "Gestern";
  if (days < 7) return date.toLocaleDateString("de-CH", { weekday: "short" });
  return date.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: days > 300 ? "2-digit" : undefined });
}
