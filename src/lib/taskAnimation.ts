import { useEffect, useSyncExternalStore } from "react";
import { setTaskDone } from "./api/tasks";
import type { Task } from "./tasks";

/**
 * Abhaken mit Animation. Der neue Zustand erscheint sofort (Haken, durchgestrichener Titel). Wandert die Aufgabe
 * danach in einen anderen Bucket oder Abschnitt, wird das Speichern kurz verzögert, damit man erst den
 * Abschluss sieht und die Karte dann sanft verschoben wird.
 */

/** So lange bleibt der abgehakte Zustand stehen, bevor die Aufgabe verschoben wird (Durchstreichen dauert 0,2 s). */
export const MOVE_DELAY_MS = 380;

const optimistic = new Map<number, boolean>();
const timers = new Map<number, number>();
const listeners = new Set<() => void>();

function setOptimistic(id: number, value: boolean | null) {
  if (value === null) optimistic.delete(id);
  else optimistic.set(id, value);
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** „Erledigt“ einer Aufgabe, einschließlich eines gerade angezeigten, noch nicht gespeicherten Zustands. */
export function useDoneState(task: Pick<Task, "id" | "done">): boolean {
  const pending = useSyncExternalStore(subscribe, () => optimistic.get(task.id));
  // Sobald die gespeicherten Daten den Zustand zeigen, wird nichts Vorläufiges mehr gebraucht
  useEffect(() => {
    if (pending !== undefined && pending === task.done) setOptimistic(task.id, null);
  }, [pending, task.done, task.id]);
  return pending ?? task.done;
}

/** Schaltet „erledigt“ um. `delayMs` verzögert das Speichern beim Abhaken, damit die Animation zu Ende laufen kann. */
export function toggleTask(task: Pick<Task, "id" | "done">, delayMs = 0) {
  const next = !(optimistic.get(task.id) ?? task.done);
  window.clearTimeout(timers.get(task.id));
  timers.delete(task.id);
  setOptimistic(task.id, next);

  const commit = async () => {
    timers.delete(task.id);
    // Wurde zwischendurch zurückgeschaltet, gibt es nichts zu speichern
    if (next === task.done) return setOptimistic(task.id, null);
    try {
      await setTaskDone(task.id, next);
    } catch {
      setOptimistic(task.id, null);
    }
  };

  if (delayMs > 0 && next) timers.set(task.id, window.setTimeout(() => void commit(), delayMs));
  else void commit();

  // Sicherung: bleibt etwas hängen, wieder auf den gespeicherten Zustand zurück
  window.setTimeout(() => {
    if (optimistic.get(task.id) === next && !timers.has(task.id)) setOptimistic(task.id, null);
  }, 4000);
}
