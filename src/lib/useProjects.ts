import { useCallback, useEffect, useState } from "react";
import { listProjects } from "./api/projects";
import { onChange } from "./changes";
import type { Project } from "./projects";

/** Alle Projekte des Assistenten. Lädt bei Änderungen automatisch neu. */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch {
      setProjects([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return onChange("projects", () => void load());
  }, [load]);

  return { projects, loaded };
}
