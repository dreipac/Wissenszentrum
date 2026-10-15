import { useCallback, useEffect, useState } from "react";
import { listDocPages } from "./api/docs";
import { onChange } from "./changes";
import type { DocPage } from "./docs";

/** Alle Seiten der Dokumentation (flach). Lädt bei Änderungen automatisch neu. */
export function useDocs() {
  const [pages, setPages] = useState<DocPage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPages(await listDocPages());
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return onChange("docs", () => void load());
  }, [load]);

  return { pages, loaded, error };
}
