import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { disableSync, enableSync, getSyncStatus, resolveSyncConflict, syncNow, syncTick } from "./api/sync";
import type { SyncNotice, SyncStatus } from "./sync";

/** Im Hintergrund nach Änderungen sehen und hochladen */
const TICK_MS = 90_000;

interface SyncValue {
  status: SyncStatus | null;
  /** Eine Aktion läuft gerade */
  busy: boolean;
  error: string | null;
  /** Einmaliger Hinweis, z. B. dass beim Start ein neuer Stand geladen wurde */
  notice: SyncNotice | null;
  dismissNotice: () => void;
  enable: (dir: string, deviceName: string) => Promise<void>;
  now: () => Promise<void>;
  resolve: (choice: "local" | "remote") => Promise<void>;
  disable: () => Promise<void>;
  refresh: () => Promise<void>;
}

const SyncContext = createContext<SyncValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<SyncNotice | null>(null);
  const enabled = useRef(false);

  const apply = useCallback((next: SyncStatus) => {
    setStatus(next);
    enabled.current = next.enabled;
    if (next.notice) setNotice(next.notice);
    // Wurde ein anderer Stand geladen, müssen alle Ansichten neu aus der Datenbank lesen
    if (next.acted === "pulled") window.location.reload();
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await getSyncStatus());
    } catch (e) {
      setError(String(e));
    }
  }, [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Regelmäßig und beim Zurückkehren ins Fenster: hochladen, was hier geändert wurde
  useEffect(() => {
    const tick = () => {
      if (!enabled.current) return;
      syncTick()
        .then(apply)
        .catch(() => undefined);
    };
    const timer = window.setInterval(tick, TICK_MS);
    window.addEventListener("blur", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("blur", tick);
    };
  }, [apply]);

  const run = useCallback(
    async (action: () => Promise<SyncStatus>) => {
      setBusy(true);
      setError(null);
      try {
        apply(await action());
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const value = useMemo<SyncValue>(
    () => ({
      status,
      busy,
      error,
      notice,
      dismissNotice: () => setNotice(null),
      enable: (dir, deviceName) => run(() => enableSync(dir, deviceName)),
      now: () => run(syncNow),
      resolve: (choice) => run(() => resolveSyncConflict(choice)),
      disable: () => run(disableSync),
      refresh,
    }),
    [status, busy, error, notice, run, refresh],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error("useSync braucht einen SyncProvider.");
  return value;
}
