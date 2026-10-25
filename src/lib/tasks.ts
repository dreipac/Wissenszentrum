import { formatDayMonth, parseDateTime, startOfDay, toDateStr, addDays } from "./dates";

export type Priority = "high" | "medium" | "low";

/** Farben für Buckets: feste Palette, die Darstellung steht in tokens.css (--bucket-…). */
export const BUCKET_COLORS = [
  { id: "blue", label: "Blau" },
  { id: "green", label: "Grün" },
  { id: "amber", label: "Gelb" },
  { id: "red", label: "Rot" },
  { id: "purple", label: "Violett" },
  { id: "pink", label: "Rosa" },
  { id: "teal", label: "Türkis" },
  { id: "gray", label: "Grau" },
] as const;

export type BucketColor = (typeof BUCKET_COLORS)[number]["id"];

export interface Bucket {
  id: number;
  name: string;
  /** Farbe aus der Palette, leer = keine */
  color: BucketColor | "";
  /** Bucket, in den abgehakte Aufgaben automatisch verschoben werden (null = nichts tun) */
  onCompleteBucketId: number | null;
}

export type BucketInput = Omit<Bucket, "id">;

/** CSS-Farbe eines Buckets oder undefined, wenn er keine hat. */
export const bucketAccent = (bucket: Pick<Bucket, "color"> | null | undefined): string | undefined =>
  bucket && bucket.color ? `var(--bucket-${bucket.color})` : undefined;

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
  /** Beginn als YYYY-MM-DD; mit der Fälligkeit ergibt das den Balken im Zeitplan (nur zusammen mit dueDate) */
  startDate: string | null;
  done: boolean;
  /** Zwischenschritte auch auf der Karte im Board anzeigen */
  showSubtasks: boolean;
  /** Notiz (Beschreibung) auch auf der Karte anzeigen */
  showDescription: boolean;
  /** Termin, an dem die Aufgabe hängt; ihr Fälligkeitsdatum richtet sich dann nach ihm */
  eventId: number | null;
  /** Abstand zum Termin in Tagen: negativ = davor, 0 = am Tag, positiv = danach (ab dem Ende des Termins) */
  eventOffset: number | null;
  /** Titel sowie Beginn und Ende (YYYY-MM-DD HH:MM) des Termins, zur Anzeige */
  eventTitle: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  subtasks: Subtask[];
}

/** Beim Speichern wird die komplette Liste der Zwischenschritte (in Reihenfolge) mitgeschickt. */
export type TaskInput = Omit<Task, "id" | "done" | "subtasks" | "eventTitle" | "eventStartsAt" | "eventEndsAt"> & {
  subtasks: SubtaskInput[];
};

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

// --- Aufgaben an Terminen ---------------------------------------------------

export type OffsetKind = "before" | "on" | "after";

export const offsetKind = (offset: number): OffsetKind => (offset < 0 ? "before" : offset > 0 ? "after" : "on");

/** Größter Abstand zu einem Termin in Tagen (wie im Backend). */
export const MAX_EVENT_OFFSET = 365;

/** Abstand zum Termin als Text, z. B. „2 Tage vorher“, „Am Tag selbst“, „1 Tag danach“. */
export function formatEventOffset(offset: number): string {
  if (offset === 0) return "Am Tag selbst";
  const n = Math.abs(offset);
  return `${n} ${n === 1 ? "Tag" : "Tage"} ${offset < 0 ? "vorher" : "danach"}`;
}

/** Fälligkeitsdatum bei diesem Abstand: davor und am Tag selbst zählt der Beginn des Termins, danach sein Ende. */
export function eventTaskDate(startsAt: string, endsAt: string, offset: number): string {
  const base = (offset > 0 ? endsAt : startsAt).slice(0, 10);
  return toDateStr(addDays(parseDateTime(`${base} 00:00`), offset));
}

/** Wann der Termin ist, vom heutigen Tag aus: „heute“, „morgen“, „in 3 Tagen“, „gestern“, „vor 2 Tagen“. */
export function formatEventIn(startsAt: string, today = new Date()): string {
  const n = daysUntil(startsAt.slice(0, 10), today);
  if (n === 0) return "heute";
  if (n === 1) return "morgen";
  if (n === -1) return "gestern";
  return n > 0 ? `in ${n} Tagen` : `vor ${-n} Tagen`;
}

/** Eingabe zum Speichern aus einer bestehenden Aufgabe; `patch` überschreibt einzelne Felder. */
export function taskToInput(task: Task, patch: Partial<TaskInput> = {}): TaskInput {
  return {
    title: task.title,
    bucketId: task.bucketId,
    priority: task.priority,
    description: task.description,
    dueDate: task.dueDate,
    startDate: task.startDate,
    showSubtasks: task.showSubtasks,
    showDescription: task.showDescription,
    eventId: task.eventId,
    eventOffset: task.eventOffset,
    subtasks: task.subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done })),
    ...patch,
  };
}
