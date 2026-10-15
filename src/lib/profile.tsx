import { createContext, useContext, type ReactNode } from "react";

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
  valid: boolean;
  profile: Profile | null;
}

export interface ProfileValue extends Profile {
  fullName: string;
  initials: string;
  dbPath: string | null;
}

export const makeInitials = (firstName: string, lastName: string) =>
  `${[...firstName.trim()][0] ?? ""}${[...lastName.trim()][0] ?? ""}`.toUpperCase();

const EMPTY: ProfileValue = { firstName: "", lastName: "", fullName: "", initials: "", dbPath: null };

const ProfileContext = createContext<ProfileValue>(EMPTY);

export function ProfileProvider({ profile, dbPath, children }: { profile: Profile; dbPath: string | null; children: ReactNode }) {
  const value: ProfileValue = {
    ...profile,
    fullName: `${profile.firstName} ${profile.lastName}`.trim(),
    initials: makeInitials(profile.firstName, profile.lastName),
    dbPath,
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
