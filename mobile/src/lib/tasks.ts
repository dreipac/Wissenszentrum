import type { Bucket, CalendarEvent, Priority, Task } from "@/data/types";
import { daysBetween, formatDayMonth, parseDateTime } from "./dates";

export const priorityLabel: Record<Priority, string> = { high: "Hoch", medium: "Mittel", low: "Niedrig" };

export const PRIORITIES: Priority[] = ["high", "medium", "low"];

const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Tage von heute bis zum Fälligkeitsdatum (negativ = überfällig). */
export const daysUntil = (dueDate: string, today = new Date()) => daysBetween(today, parseDateTime(`${dueDate} 00:00`));

export const isOverdue = (task: Task, today = new Date()) => !task.done && task.dueDate !== null && daysUntil(task.dueDate, today) < 0;

export function formatDue(dueDate: string, today = new Date()): string {
  const diff = daysUntil(dueDate, today);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  return formatDayMonth(parseDateTime(`${dueDate} 00:00`));
}

export const subtaskProgress = (task: Task) => ({ done: task.subtasks.filter((s) => s.done).length, total: task.subtasks.length });

export const bucketOf = (buckets: Bucket[], id: number | null) => buckets.find((b) => b.id === id) ?? null;

export const eventOf = (events: CalendarEvent[], id: number | null) => events.find((e) => e.id === id) ?? null;

/** Wichtigste zuerst, dann nach Datum, dann nach Titel. */
export function byImportance(a: Task, b: Task): number {
  return priorityRank[a.priority] - priorityRank[b.priority] || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title, "de");
}

export type TaskGroupKey = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export const GROUP_TITLES: Record<TaskGroupKey, string> = {
  overdue: "Überfällig",
  today: "Heute",
  tomorrow: "Morgen",
  week: "Diese Woche",
  later: "Später",
  none: "Ohne Datum",
};

const GROUP_ORDER: TaskGroupKey[] = ["overdue", "today", "tomorrow", "week", "later", "none"];

export function groupKey(task: Task, today = new Date()): TaskGroupKey {
  if (task.dueDate === null) return "none";
  const diff = daysUntil(task.dueDate, today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return diff <= 7 ? "week" : "later";
}

export interface TaskGroup {
  key: TaskGroupKey;
  title: string;
  tasks: Task[];
}

/** Offene Aufgaben nach Fälligkeit gruppiert, leere Gruppen entfallen. */
export function groupOpenTasks(tasks: Task[], today = new Date()): TaskGroup[] {
  const open = tasks.filter((t) => !t.done).sort(byImportance);
  return GROUP_ORDER.map((key) => ({ key, title: GROUP_TITLES[key], tasks: open.filter((t) => groupKey(t, today) === key) })).filter((g) => g.tasks.length > 0);
}
