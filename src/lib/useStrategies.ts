import { useCallback, useEffect, useState } from "react";
import { listStrategies } from "./api/strategies";
import { onChange } from "./changes";
import type { Strategy } from "./strategies";

/** Alle Strategien samt Graph, zuletzt bearbeitete zuerst. Lädt bei Änderungen automatisch neu. */
export function useStrategies() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStrategies(await listStrategies());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return onChange("strategies", () => void load());
  }, [load]);

  return { strategies, loaded, error };
}
