/**
 * Die Schnittstelle zwischen Oberfläche und Daten. Der Store (store.ts) spricht nur mit dieser Schnittstelle:
 * heute liefert `memoryRepository` Beispieldaten, später kommt eine Implementierung mit SQLite (Phase 4) dazu,
 * ohne dass sich ein Bildschirm ändert.
 */
import type { CalendarEvent, Note, Snapshot, Task } from "./types";

export interface Repository {
  /** Lädt alles, was die App anzeigt. */
  load(): Promise<Snapshot>;
  saveTask(task: Task): Promise<void>;
  removeTask(id: number): Promise<void>;
  saveEvent(event: CalendarEvent): Promise<void>;
  removeEvent(id: number): Promise<void>;
  saveNote(note: Note): Promise<void>;
  removeNote(id: number): Promise<void>;
}
