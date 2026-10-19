// Merkt sich, welche Dokumentationsseite die Ansicht als Nächstes öffnen soll (z. B. Klick im Dashboard unter „Zuletzt bearbeitet“).
// Gleiches Muster wie notesNav: nur lesen (peek), erst nach Gebrauch löschen.
const bus = new EventTarget();
let pending: number | null = null;

export function requestOpenDoc(id: number) {
  pending = id;
  bus.dispatchEvent(new Event("open"));
}

export const peekPendingDoc = () => pending;

export function clearPendingDoc() {
  pending = null;
}

export function onOpenDocRequest(listener: () => void): () => void {
  bus.addEventListener("open", listener);
  return () => bus.removeEventListener("open", listener);
}
