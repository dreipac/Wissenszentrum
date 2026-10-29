import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { dbFileIn, type AppState, type LocationInfo, type Profile } from "../profile";
import { inTauri } from "./runtime";

export interface OnboardingInput extends Profile {
  /** Ordner, in dem die Datenbank liegen soll */
  dir: string;
}

// Browser-Preview ohne Tauri: Das Profil bleibt im localStorage, damit ein Neuladen das Onboarding nicht wiederholt.
const PREVIEW_KEY = "wz-preview-profile";
const PREVIEW_DIR = "C:\\Users\\Preview\\Documents\\Wissenszentrum";

function readPreview(): { profile: Profile; dir: string } | null {
  try {
    const raw = localStorage.getItem(PREVIEW_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const previewState = (): AppState => {
  const saved = readPreview();
  return {
    onboarded: saved !== null,
    profile: saved?.profile ?? null,
    dbPath: saved ? dbFileIn(saved.dir) : null,
    defaultDir: saved?.dir ?? PREVIEW_DIR,
    problem: null,
  };
};

export const getAppState = (): Promise<AppState> => (inTauri ? invoke("app_state") : Promise.resolve(previewState()));

export const inspectLocation = (dir: string): Promise<LocationInfo> =>
  inTauri
    ? invoke("inspect_location", { dir })
    : Promise.resolve({ dbPath: dbFileIn(dir), exists: false, valid: false, needsUpdate: false, newer: false, profile: null });

/** Prüft eine einzelne Datenbankdatei, ohne etwas zu verändern. */
export const inspectDatabase = (path: string): Promise<LocationInfo> =>
  inTauri
    ? invoke("inspect_database_file", { path })
    : Promise.resolve({ dbPath: path, exists: true, valid: /\.(db|sqlite3?)$/i.test(path.trim()), needsUpdate: false, newer: false, profile: null });

export interface OpenExistingInput {
  path: string;
  /** Nur nötig, wenn in der Datenbank noch kein Name steht */
  firstName: string;
  lastName: string;
}

/** Übernimmt eine vorhandene Datenbankdatei. Ältere Dateien werden nach einer Sicherung aktualisiert. */
export async function openExistingDatabase({ path, firstName, lastName }: OpenExistingInput): Promise<AppState> {
  if (inTauri) return invoke("open_existing_database", { path, firstName, lastName });
  if (!firstName.trim() || !lastName.trim()) throw "In dieser Datenbank ist noch kein Name hinterlegt. Bitte gib deinen Namen ein.";
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify({ profile: { firstName: firstName.trim(), lastName: lastName.trim() }, dir }));
  } catch {
    /* nur Vorschau */
  }
  return previewState();
}

export async function completeOnboarding({ firstName, lastName, dir }: OnboardingInput): Promise<AppState> {
  if (inTauri) return invoke("complete_onboarding", { firstName, lastName, dir });
  if (!firstName.trim() || !lastName.trim() || !dir.trim()) throw "Bitte fülle alle Felder aus.";
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify({ profile: { firstName: firstName.trim(), lastName: lastName.trim() }, dir: dir.trim() }));
  } catch {
    /* nur Vorschau */
  }
  return previewState();
}

/** Öffnet den Dateidialog des Systems für eine Datenbankdatei; null, wenn abgebrochen. */
export async function pickDatabaseFile(defaultPath: string): Promise<string | null> {
  if (inTauri) {
    const result = await open({
      directory: false,
      multiple: false,
      defaultPath,
      title: "Datenbank des Wissenszentrums öffnen",
      filters: [
        { name: "Datenbank", extensions: ["db", "sqlite", "sqlite3"] },
        { name: "Alle Dateien", extensions: ["*"] },
      ],
    });
    return typeof result === "string" ? result : null;
  }
  return window.prompt("Pfad der Datenbankdatei (nur in der Vorschau)", defaultPath)?.trim() || null;
}

/** Öffnet den Ordnerdialog des Systems; null, wenn abgebrochen. Im Browser-Preview ersetzt eine Eingabe den Dialog. */
export async function pickFolder(defaultPath: string): Promise<string | null> {
  if (inTauri) {
    const result = await open({ directory: true, multiple: false, defaultPath, title: "Speicherort für deine Daten wählen" });
    return typeof result === "string" ? result : null;
  }
  return window.prompt("Speicherort (nur in der Vorschau)", defaultPath)?.trim() || null;
}

/** Ändert Vor- und Nachname; liefert das gespeicherte (bereinigte) Profil. */
export async function updateProfile(firstName: string, lastName: string): Promise<Profile> {
  if (inTauri) return invoke("update_profile", { firstName, lastName });
  const first = firstName.split(/\s+/).filter(Boolean).join(" ");
  const last = lastName.split(/\s+/).filter(Boolean).join(" ");
  if (!first) throw "Bitte gib deinen Vornamen ein.";
  if (!last) throw "Bitte gib deinen Nachnamen ein.";
  const saved = readPreview();
  if (saved) {
    try {
      localStorage.setItem(PREVIEW_KEY, JSON.stringify({ ...saved, profile: { firstName: first, lastName: last } }));
    } catch {
      /* nur Vorschau */
    }
  }
  return { firstName: first, lastName: last };
}

const BACKUP_FILTER = [{ name: "Datenbank", extensions: ["db"] }];

/** Datum für den Dateinamen einer Sicherung: YYYY-MM-DD in Ortszeit. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Fragt nach dem Ziel und schreibt dort eine Sicherungskopie der Datenbank. Liefert den Ort oder null bei Abbruch. */
export async function exportBackup(): Promise<string | null> {
  if (!inTauri) throw "Sicherungen gibt es nur in der installierten App.";
  const path = await save({ defaultPath: `Wissenszentrum-Sicherung-${today()}.db`, title: "Sicherung speichern", filters: BACKUP_FILTER });
  if (!path) return null;
  await invoke("export_backup", { path });
  return path;
}

/** Fragt nach einer Sicherungsdatei; null bei Abbruch. */
export async function pickBackupFile(): Promise<string | null> {
  if (!inTauri) throw "Sicherungen gibt es nur in der installierten App.";
  const result = await open({
    directory: false,
    multiple: false,
    title: "Sicherung auswählen",
    filters: [...BACKUP_FILTER, { name: "Alle Dateien", extensions: ["*"] }],
  });
  return typeof result === "string" ? result : null;
}

/** Ersetzt alle Daten durch die Sicherungsdatei. Der bisherige Stand wird vorher im Datenordner der App gesichert. */
export const restoreBackup = (path: string): Promise<void> => invoke("restore_backup", { path });
