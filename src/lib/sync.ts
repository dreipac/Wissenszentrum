export type SyncState = "off" | "uptodate" | "push" | "pull" | "conflict" | "waiting" | "error";

export interface SyncRemote {
  deviceName: string;
  /** UTC, `YYYY-MM-DD HH:MM:SS` */
  savedAt: string;
  /** Der Stand im Ordner stammt von diesem Rechner */
  thisDevice: boolean;
}

export interface SyncNotice {
  kind: "pulled";
  deviceName: string;
  savedAt: string;
}

export interface SyncStatus {
  enabled: boolean;
  state: SyncState;
  syncDir: string | null;
  deviceName: string | null;
  remote: SyncRemote | null;
  /** Dieser Rechner hat Änderungen, die noch nicht im Ordner liegen */
  localChanges: boolean;
  /** Dieser Rechner war noch nie mit dem Ordner abgeglichen */
  firstTime: boolean;
  lastSyncedAt: string | null;
  message: string | null;
  /** Was gerade passiert ist */
  acted: "pushed" | "pulled" | "adopted" | null;
  notice: SyncNotice | null;
  suggestedDir: string | null;
  defaultDeviceName: string;
}

export const stateLabel: Record<SyncState, string> = {
  off: "Aus",
  uptodate: "Aktuell",
  push: "Änderungen werden hochgeladen",
  pull: "Neuer Stand verfügbar",
  conflict: "Konflikt",
  waiting: "Wartet auf die Synchronisierung",
  error: "Problem",
};

/** Farbe des Punktes am Abgleich-Symbol: ok, wartend oder Problem. */
export const stateTone = (state: SyncState): "none" | "ok" | "pending" | "problem" =>
  state === "off" ? "none" : state === "uptodate" ? "ok" : state === "conflict" || state === "error" ? "problem" : "pending";
