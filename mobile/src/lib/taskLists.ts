import type { Bucket, Task } from "@/data/types";
import { byImportance, daysUntil, isOverdue } from "./tasks";

/** Die Listen der Aufgaben: vier feste (Heute, Geplant, Alle, Erledigt), „Überfällig“ vom Dashboard aus und je Bucket eine. */
export type ListKey = "today" | "overdue" | "planned" | "all" | "done" | "bucket-none" | `bucket-${number}`;

export const bucketKey = (id: number | null): ListKey => (id === null ? "bucket-none" : (`bucket-${id}` as ListKey));

/** Offene Aufgaben, die heute fällig oder schon überfällig sind. */
export const isDueNow = (t: Task, today = new Date()) => !t.done && t.dueDate !== null && daysUntil(t.dueDate, today) <= 0;

export function tasksFor(key: string, tasks: Task[], today = new Date()): Task[] {
  switch (key) {
    case "today":
      return tasks.filter((t) => isDueNow(t, today));
    case "overdue":
      return tasks.filter((t) => isOverdue(t, today));
    case "planned":
      return tasks.filter((t) => !t.done && t.dueDate !== null);
    case "all":
      return tasks.filter((t) => !t.done);
    case "done":
      return tasks.filter((t) => t.done).sort(byImportance);
    case "bucket-none":
      return tasks.filter((t) => !t.done && t.bucketId === null);
    default: {
      const id = Number(key.replace("bucket-", ""));
      return Number.isFinite(id) ? tasks.filter((t) => !t.done && t.bucketId === id) : [];
    }
  }
}

export function listTitle(key: string, buckets: Bucket[]): string {
  const fixed: Record<string, string> = { today: "Heute", overdue: "Überfällig", planned: "Geplant", all: "Alle", done: "Erledigt", "bucket-none": "Ohne Bucket" };
  if (fixed[key]) return fixed[key];
  const id = Number(key.replace("bucket-", ""));
  return buckets.find((b) => b.id === id)?.name ?? "Aufgaben";
}
