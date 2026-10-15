import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
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
  inTauri ? invoke("inspect_location", { dir }) : Promise.resolve({ dbPath: dbFileIn(dir), exists: false, valid: false, profile: null });

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

/** Öffnet den Ordnerdialog des Systems; null, wenn abgebrochen. Im Browser-Preview ersetzt eine Eingabe den Dialog. */
export async function pickFolder(defaultPath: string): Promise<string | null> {
  if (inTauri) {
    const result = await open({ directory: true, multiple: false, defaultPath, title: "Speicherort für deine Daten wählen" });
    return typeof result === "string" ? result : null;
  }
  return window.prompt("Speicherort (nur in der Vorschau)", defaultPath)?.trim() || null;
}
