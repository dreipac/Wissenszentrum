import { invoke } from "@tauri-apps/api/core";
import type { SyncStatus } from "../sync";
import { inTauri } from "./runtime";
import { syncPreview } from "./syncPreview";

export const getSyncStatus = (): Promise<SyncStatus> => (inTauri ? invoke("sync_status") : syncPreview.status());

/** Schaltet den Abgleich mit dem Ordner ein und gleicht, wenn es ohne Rückfrage geht, gleich ab. */
export const enableSync = (dir: string, deviceName: string): Promise<SyncStatus> =>
  inTauri ? invoke("sync_enable", { dir, deviceName }) : syncPreview.enable(dir, deviceName);

/** Jetzt abgleichen: hochladen oder, wenn hier nichts geändert wurde, den neuen Stand laden. */
export const syncNow = (): Promise<SyncStatus> => (inTauri ? invoke("sync_now") : syncPreview.now());

/** Im Hintergrund: lädt höchstens hoch, nie herunter. */
export const syncTick = (): Promise<SyncStatus> => (inTauri ? invoke("sync_tick") : syncPreview.status());

/** Konflikt lösen: "local" überschreibt den Ordner, "remote" überschreibt diesen Rechner. Der Verlierer wird gesichert. */
export const resolveSyncConflict = (choice: "local" | "remote"): Promise<SyncStatus> =>
  inTauri ? invoke("sync_resolve", { choice }) : syncPreview.resolve(choice);

export const disableSync = (): Promise<SyncStatus> => (inTauri ? invoke("sync_disable") : syncPreview.disable());
