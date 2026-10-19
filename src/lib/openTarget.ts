import { useEffect, useRef } from "react";

/**
 * Wohin die Suche eine Ansicht schicken will: einen Termin im Kalender, eine Strategie, eine Position, eine neue Seite.
 * Wie bei notesNav/docsNav wird der Wunsch nur gelesen (peek) und nach Gebrauch gelöscht; die Ansicht erfährt ihn
 * entweder beim Start oder per Signal, wenn sie schon offen ist.
 */
export type OpenTarget =
  | { kind: "event"; id: number; date: string }
  | { kind: "strategy"; id: number }
  | { kind: "trade"; id: number }
  | { kind: "new-doc" };

const bus = new EventTarget();
let pending: OpenTarget | null = null;

export function requestOpen(target: OpenTarget) {
  pending = target;
  bus.dispatchEvent(new Event("open"));
}

/** Nimmt Wünsche einer Art entgegen: sofort, falls schon einer wartet, und später per Signal. */
export function useOpenTarget<K extends OpenTarget["kind"]>(kind: K, handler: (target: Extract<OpenTarget, { kind: K }>) => void) {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    const take = () => {
      if (!pending || pending.kind !== kind) return;
      const target = pending as Extract<OpenTarget, { kind: K }>;
      pending = null;
      latest.current(target);
    };
    take();
    bus.addEventListener("open", take);
    return () => bus.removeEventListener("open", take);
  }, [kind]);
}
