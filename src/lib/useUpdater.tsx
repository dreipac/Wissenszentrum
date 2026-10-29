import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { checkForUpdate, relaunchApp, type Update } from "./api/updater";
import { inTauri } from "./api/runtime";

/** Beim Start erst nach kurzer Zeit nachsehen, danach in großen Abständen */
const FIRST_CHECK_MS = 8_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Pro Rechner gemerkt (gehört nicht in die Datenbank, damit der Abgleich sie nicht auf andere Rechner überträgt) */
const AUTO_KEY = "wz-auto-update";

/** Ob die App von selbst nach Updates sucht. Standard: an, bis jemand im Onboarding oder in den Einstellungen „Aus“ wählt. */
export function readAutoUpdate(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeAutoUpdate(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? "on" : "off");
  } catch {
    /* Die Wahl gilt dann nur bis zum Schließen */
  }
}

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string; notes: string | null }
  /** `percent` ist null, solange der Server die Größe nicht nennt */
  | { kind: "downloading"; version: string; percent: number | null }
  | { kind: "error"; message: string };

interface UpdaterValue {
  state: UpdateState;
  /** Ein Update wurde gefunden, die Person hat den Hinweis aber für diese Sitzung weggeklickt */
  dismissed: boolean;
  dismiss: () => void;
  /** Ob die App von selbst nach Updates sucht. Aus = es wird nichts abgefragt, außer auf ausdrücklichen Wunsch. */
  auto: boolean;
  setAuto: (on: boolean) => void;
  /** `manual`: auch „aktuell“ und Fehler melden; im Hintergrund bleibt es still */
  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

const UpdaterContext = createContext<UpdaterValue | null>(null);

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Sucht im Hintergrund nach Updates und spielt sie nach Bestätigung ein. */
export function UpdaterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const [auto, setAutoState] = useState(readAutoUpdate);
  const update = useRef<Update | null>(null);
  const running = useRef(false);

  const check = useCallback(async (manual = false) => {
    if (running.current) return;
    running.current = true;
    if (manual) setState({ kind: "checking" });
    try {
      const found = await checkForUpdate();
      update.current = found;
      if (found) {
        setState({ kind: "available", version: found.version, notes: found.body?.trim() || null });
        if (manual) setDismissed(false);
      } else if (manual) {
        setState({ kind: "current" });
      }
    } catch (e) {
      // Offline oder Server nicht erreichbar ist im Hintergrund kein Grund zu stören
      console.warn("Update-Suche fehlgeschlagen:", e);
      if (manual) setState({ kind: "error", message: `Keine Verbindung zum Update-Server. Die App funktioniert weiter wie gewohnt; die neue Version kannst du auch von Hand herunterladen. (${describe(e)})` });
    } finally {
      running.current = false;
    }
  }, []);

  const install = useCallback(async () => {
    const found = update.current;
    if (!found || running.current) return;
    running.current = true;
    let total = 0;
    let received = 0;
    setState({ kind: "downloading", version: found.version, percent: null });
    try {
      await found.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (total > 0) setState({ kind: "downloading", version: found.version, percent: Math.min(100, Math.round((received / total) * 100)) });
        }
      });
      // Unter Windows beendet der Installer die App meist selbst; sonst von Hand neu starten
      await relaunchApp();
    } catch (e) {
      setState({ kind: "error", message: `Das Update konnte nicht installiert werden. ${describe(e)}` });
    } finally {
      running.current = false;
    }
  }, []);

  const setAuto = useCallback((on: boolean) => {
    setAutoState(on);
    writeAutoUpdate(on);
  }, []);

  useEffect(() => {
    // Im Entwicklungsmodus gibt es nichts zu aktualisieren; ausgeschaltet bleibt die App still
    if (!inTauri || import.meta.env.DEV || !auto) return;
    const first = window.setTimeout(() => void check(false), FIRST_CHECK_MS);
    const interval = window.setInterval(() => void check(false), CHECK_EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [check, auto]);

  const value = useMemo<UpdaterValue>(
    () => ({ state, dismissed, dismiss: () => setDismissed(true), auto, setAuto, check, install }),
    [state, dismissed, auto, setAuto, check, install],
  );
  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}

export function useUpdater(): UpdaterValue {
  const value = useContext(UpdaterContext);
  if (!value) throw new Error("useUpdater braucht den UpdaterProvider.");
  return value;
}
