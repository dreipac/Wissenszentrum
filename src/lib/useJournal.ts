import { useCallback, useEffect, useState } from "react";
import { listJournal } from "./api/journal";
import { onChange } from "./changes";
import type { JournalEntry } from "./journal";

/** Das gesamte Logbuch (neueste zuerst). Lädt bei Änderungen im Trading automatisch neu. */
export function useJournal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntries(await listJournal());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return onChange("trading", () => void load());
  }, [load]);

  return { entries, loaded, error };
}
