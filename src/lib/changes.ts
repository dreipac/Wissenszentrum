// Kleiner Signalgeber: Nach Änderungen an den Daten laden alle Ansichten, die dasselbe Thema anzeigen, automatisch neu.
const bus = new EventTarget();

export type ChangeTopic = "tasks" | "events" | "projects" | "notes" | "trading" | "strategies" | "docs";

export const notifyChange = (topic: ChangeTopic) => bus.dispatchEvent(new Event(topic));

export function onChange(topic: ChangeTopic, listener: () => void): () => void {
  bus.addEventListener(topic, listener);
  return () => bus.removeEventListener(topic, listener);
}
