import { Appearance } from "react-native";
import { create } from "zustand";

export type AppearanceChoice = "system" | "dark" | "light";

interface Prefs {
  appearance: AppearanceChoice;
  setAppearance: (choice: AppearanceChoice) => void;
}

/** Einstellungen der App. Bleiben vorerst nur bis zum Schließen erhalten (die Speicherung kommt mit der Datenbank). */
export const usePrefs = create<Prefs>((set) => ({
  appearance: "system",
  setAppearance: (appearance) => {
    // Auch Systemelemente (Tastatur, Dialoge) sollen dem gewählten Schema folgen
    Appearance.setColorScheme(appearance === "system" ? "unspecified" : appearance);
    set({ appearance });
  },
}));
