import { invoke } from "@tauri-apps/api/core";
import { notifyChange } from "../changes";
import type { Note, NoteInput } from "../notes";
import { notesStore } from "./browserStore";
import { inTauri } from "./runtime";

export const listNotes = (): Promise<Note[]> => (inTauri ? invoke("list_notes") : notesStore.list());

/** Nach jeder Änderung werden alle Notizen-Ansichten benachrichtigt. */
async function changed<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  notifyChange("notes");
  return value;
}

export const createNote = (input: NoteInput): Promise<Note> =>
  changed(inTauri ? invoke("create_note", { input }) : notesStore.create(input));

export const updateNote = (id: number, input: NoteInput): Promise<Note> =>
  changed(inTauri ? invoke("update_note", { id, input }) : notesStore.update(id, input));

export const setNotePinned = (id: number, pinned: boolean): Promise<Note> =>
  changed(inTauri ? invoke("set_note_pinned", { id, pinned }) : notesStore.setPinned(id, pinned));

export const deleteNote = (id: number): Promise<void> =>
  changed(inTauri ? invoke("delete_note", { id }) : notesStore.remove(id));

/** Entfernt Notizen ohne Titel und Text (außer `exceptId`). Meldet Änderungen nur, wenn etwas gelöscht wurde. */
export async function purgeEmptyNotes(exceptId: number | null): Promise<number> {
  const removed = await (inTauri ? invoke<number>("purge_empty_notes", { exceptId }) : notesStore.purge(exceptId));
  if (removed > 0) notifyChange("notes");
  return removed;
}
