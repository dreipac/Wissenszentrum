import { useCallback, useEffect, useState } from "react";
import { listBuckets, listTasks } from "./api/tasks";
import { onChange } from "./changes";
import type { Bucket, Task } from "./tasks";

/** Alle Aufgaben und Buckets. Lädt automatisch neu, sobald irgendwo etwas geändert wurde. */
export function useTasks() {
  const [data, setData] = useState<{ tasks: Task[]; buckets: Bucket[] }>({ tasks: [], buckets: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [buckets, tasks] = await Promise.all([listBuckets(), listTasks()]);
      setData({ buckets, tasks });
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return onChange("tasks", () => void load());
  }, [load]);

  return { ...data, loaded, error };
}
