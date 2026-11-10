/**
 * Datenmodell der Mobil-App. Namen und Bedeutung folgen der Desktop-App (src/lib/tasks.ts, calendar.ts, notes.ts und das
 * Schema in src-tauri/src/db.rs), damit sich später dieselbe Datenbank und ein Abgleich anbinden lassen.
 */
import type { BucketColor } from "@/theme/theme";

export type Priority = "high" | "medium" | "low";

export interface Bucket {
  id: number;
  name: string;
  color: BucketColor | "";
}

export interface Subtask {
  id: number;
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
  /** Termin, an dem die Aufgabe hängt (Vorbereitung oder Nachbereitung) */
  eventId: number | null;
  subtasks: Subtask[];
}

export type TaskDraft = Omit<Task, "id" | "done">;

export interface CalendarEvent {
  id: number;
  title: string;
  description: string;
  location: string;
  /** Lokale Zeit "YYYY-MM-DD HH:MM" */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

export type EventDraft = Omit<CalendarEvent, "id">;

export interface Note {
  id: number;
  title: string;
  /** Inhalt als HTML (am Desktop schreibt TipTap, hier zeigt und schreibt die App vorerst nur Absätze) */
  content: string;
  /** Inhalt als reiner Text (Vorschau und Suche) */
  plain: string;
  /** Leer = ohne Ordner */
  folder: string;
  pinned: boolean;
  /** UTC "YYYY-MM-DD HH:MM:SS" wie in der Datenbank */
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  firstName: string;
  lastName: string;
}

/** Alles, was die App lädt. */
export interface Snapshot {
  profile: Profile;
  buckets: Bucket[];
  tasks: Task[];
  events: CalendarEvent[];
  notes: Note[];
}
