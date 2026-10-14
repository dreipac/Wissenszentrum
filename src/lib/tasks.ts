import { formatDayMonth, parseDateTime, startOfDay, toDateStr, addDays } from "./dates";

export type Priority = "high" | "medium" | "low";

export interface Bucket {
  id: number;
  name: string;
  /** Bucket, in den abgehakte Aufgaben automatisch verschoben werden (null = nichts tun) */
  onCompleteBucketId: number | null;
}

export type BucketInput = Omit<Bucket, "id">;

export interface Subtask {
  id: number;
  title: string;
  done: boolean;
}

/** Zwischenschritt beim Speichern: mit id wird ein bestehender aktualisiert, mit null ein neuer angelegt. */
export interface SubtaskInput {
  id: number | null;
  title: string;
  done: boolean;
}

export interface Task {
  id: number;
  bucketId: number | null;
  title: string;
  description: string;
  priority: Priority;
  /** Fälligkeitsdatum als YYYY-MM-DD */
  dueDate: string | null;
  done: boolean;
  /** Zwischenschritte auch auf der Karte im Board anzeigen */
  showSubtasks: boolean;
  subtasks: Subtask[];
}

/** Beim Speichern wird die komplette Liste der Zwischenschritte (in Reihenfolge) mitgeschickt. */
export type TaskInput = Omit<Task, "id" | "done" | "subtasks"> & { subtasks: SubtaskInput[] };

/** Erledigte und gesamte Zwischenschritte. */
export const subtaskProgress = (task: Task) => ({
  done: task.subtasks.filter((s) => s.done).length,
  total: task.subtasks.length,
});

export const priorities: Priority[] = ["high", "medium", "low"];

export const priorityLabel: Record<Priority, string> = {
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
};

/** Tage von heute bis zum Fälligkeitsdatum (negativ = überfällig). */
export function daysUntil(dueDate: string, today = new Date()): number {
  const due = startOfDay(parseDateTime(`${dueDate} 00:00`));
  return Math.round((due.getTime() - startOfDay(today).getTime()) / 86_400_000);
}

export function isOverdue(task: Task, today = new Date()): boolean {
  return !task.done && task.dueDate !== null && daysUntil(task.dueDate, today) < 0;
}

export function formatDue(dueDate: string, today = new Date()): string {
  const diff = daysUntil(dueDate, today);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  return formatDayMonth(parseDateTime(`${dueDate} 00:00`));
}

/** Datum als YYYY-MM-DD, n Tage ab heute. */
export const dateInDays = (n: number) => toDateStr(addDays(startOfDay(new Date()), n));
