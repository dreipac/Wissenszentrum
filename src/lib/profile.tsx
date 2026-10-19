import { createContext, useContext, type ReactNode } from "react";

import { updateProfile } from "./api/app";

export interface Profile {
  firstName: string;
  lastName: string;
}

/** Zustand beim Start: ob das Onboarding schon durchlaufen wurde und wo die Datenbank liegt. */
export interface AppState {
  onboarded: boolean;
  profile: Profile | null;
  /** Vollständiger Pfad der Datenbankdatei */
  dbPath: string | null;
  /** Vorschlag für den Speicherort im Onboarding */
  defaultDir: string;
  /** Hinweis, falls die zuletzt verwendete Datenbank nicht geöffnet werden konnte */
  problem: string | null;
}

export interface LocationInfo {
  dbPath: string;
  exists: boolean;
  /** Gültige Datenbank dieser App, die sich öffnen lässt */
  valid: boolean;
  /** Gültig, stammt aber aus einer älteren Version und wird beim Öffnen aktualisiert */
  needsUpdate: boolean;
  /** Stammt aus einer neueren Version der App */
  newer: boolean;
  profile: Profile | null;
}

export interface ProfileValue extends Profile {
  fullName: string;
  initials: string;
  dbPath: string | null;
  /** Ändert den Namen und aktualisiert die Anzeige überall */
  update: (firstName: string, lastName: string) => Promise<void>;
}

export const makeInitials = (firstName: string, lastName: string) =>
  `${[...firstName.trim()][0] ?? ""}${[...lastName.trim()][0] ?? ""}`.toUpperCase();

const EMPTY: ProfileValue = { firstName: "", lastName: "", fullName: "", initials: "", dbPath: null, update: async () => undefined };

const ProfileContext = createContext<ProfileValue>(EMPTY);

export function ProfileProvider({ profile, dbPath, onChange, children }: { profile: Profile; dbPath: string | null; onChange: (profile: Profile) => void; children: ReactNode }) {
  const value: ProfileValue = {
    ...profile,
    fullName: `${profile.firstName} ${profile.lastName}`.trim(),
    initials: makeInitials(profile.firstName, profile.lastName),
    dbPath,
    update: async (firstName, lastName) => onChange(await updateProfile(firstName, lastName)),
  };
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export const useProfile = () => useContext(ProfileContext);

/** Pfad der Datenbankdatei in einem Ordner (mit dem Trennzeichen, das der Ordnerpfad schon benutzt). */
export function dbFileIn(dir: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  const sep = trimmed.includes("/") && !trimmed.includes("\\") ? "/" : "\\";
  return `${trimmed}${sep}wissenszentrum.db`;
}
