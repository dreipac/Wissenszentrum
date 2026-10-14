import { useCallback, useEffect, useState } from "react";
import { listNotes } from "./api/notes";
import { onChange } from "./changes";
import type { Note } from "./notes";

/** Alle Notizen (angepinnte zuerst, dann zuletzt bearbeitete). Lädt bei Änderungen automatisch neu. */
export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setNotes(await listNotes());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return onChange("notes", () => void load());
  }, [load]);

  return { notes, loaded, error };
}
