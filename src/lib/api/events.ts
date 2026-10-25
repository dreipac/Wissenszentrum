import { invoke } from "@tauri-apps/api/core";
import type { CalendarEvent, EventInput } from "../calendar";
import { notifyChange } from "../changes";
import { browserStore } from "./browserStore";
import { inTauri } from "./runtime";

/** Termine, die den Zeitraum [from, to) überlappen. Format: "YYYY-MM-DD HH:MM". */
export function listEvents(from: string, to: string): Promise<CalendarEvent[]> {
  return inTauri ? invoke("list_events", { from, to }) : browserStore.list(from, to);
}

export function createEvent(input: EventInput): Promise<CalendarEvent> {
  return inTauri ? invoke("create_event", { input }) : browserStore.create(input);
}

/** Ein verschobener oder gelöschter Termin ändert die Daten seiner Aufgaben; die Aufgaben-Ansichten laden danach neu. */
async function tasksFollow<T>(result: Promise<T>): Promise<T> {
  const value = await result;
  notifyChange("tasks");
  return value;
}

export function updateEvent(id: number, input: EventInput): Promise<CalendarEvent> {
  return tasksFollow(inTauri ? invoke("update_event", { id, input }) : browserStore.update(id, input));
}

export function deleteEvent(id: number): Promise<void> {
  return tasksFollow(inTauri ? invoke("delete_event", { id }) : browserStore.remove(id));
}
