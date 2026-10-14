// Merkt sich, welche Notiz die Notizen-Ansicht als Nächstes öffnen soll (z. B. frisch angelegt über „Neue Notiz“).
// Ist die Ansicht schon offen, wird sie per Signal benachrichtigt; sonst liest sie den Wert beim Start.
// Der Wert wird nur gelesen (peek) und erst nach Gebrauch gelöscht, damit doppeltes Aufrufen (React StrictMode) nichts verliert.
const bus = new EventTarget();
let pending: number | null = null;

export function requestOpenNote(id: number) {
  pending = id;
  bus.dispatchEvent(new Event("open"));
}

export const peekPendingNote = () => pending;

export function clearPendingNote() {
  pending = null;
}

export function onOpenNoteRequest(listener: () => void): () => void {
  bus.addEventListener("open", listener);
  return () => bus.removeEventListener("open", listener);
}
