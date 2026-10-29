import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { inTauri } from "./runtime";

/** Version der installierten App; im Browser-Preview ohne Tauri gibt es keine. */
export const appVersion = (): Promise<string | null> => (inTauri ? getVersion() : Promise.resolve(null));

/** Fragt den Update-Server, ob es eine neuere, signierte Version gibt. Im Browser-Preview immer „nein“. */
export const checkForUpdate = (): Promise<Update | null> => (inTauri ? check() : Promise.resolve(null));

/** Startet die App neu, nachdem ein Update eingespielt wurde. */
export const relaunchApp = (): Promise<void> => relaunch();

/** Öffnet den Ordner mit den Protokolldateien (für die Fehlersuche). */
export const openLogFolder = (): Promise<void> => (inTauri ? invoke("open_log_folder") : Promise.reject("Das Protokoll gibt es nur in der installierten App."));

/** Öffnet die Seite mit den Installern im Browser, damit man die neue Version von Hand laden kann. */
export const openDownloadPage = (): Promise<void> => (inTauri ? invoke("open_download_page") : Promise.reject("Das geht nur in der installierten App."));

export type { Update };
