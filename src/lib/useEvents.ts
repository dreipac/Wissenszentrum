import { useCallback, useEffect, useState } from "react";
import type { CalendarEvent } from "./calendar";
import { listEvents } from "./api/events";
import { onChange } from "./changes";

/** Lädt Termine für [from, to) und lädt bei Änderung des Zeitraums neu. */
export function useEvents(from: string, to: string) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setEvents(await listEvents(from, to));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [from, to]);

  // Aufgaben am Termin zählen im Termin mit: Änderungen an Aufgaben laden die Termine neu
  useEffect(() => onChange("tasks", () => void reload()), [reload]);

  useEffect(() => {
    let cancelled = false;
    listEvents(from, to)
      .then((list) => {
        if (!cancelled) {
          setEvents(list);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return { events, error, reload };
}
