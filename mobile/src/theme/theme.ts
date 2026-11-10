import { useColorScheme } from "react-native";
import { usePrefs } from "./prefs";

/**
 * Farben und Maße der App. Akzent und Bucket-Farben stammen aus den Design-Tokens der Desktop-App
 * (src/styles/tokens.css). Die Flächen sind auf dem Telefon bewusst kontrastreicher: ein dunkler Grund und hellere Karten
 * (dunkel), bzw. ein hellgrauer Grund und weiße Karten (hell), wie in den gruppierten Listen von iOS.
 */

export type BucketColor = "blue" | "green" | "amber" | "red" | "purple" | "pink" | "teal" | "gray";

export interface Theme {
  mode: "dark" | "light";
  /** Grund der Bildschirme */
  bg: string;
  /** Eingabefelder und Vertiefungen */
  bgSecondary: string;
  /** Karten und Listen */
  card: string;
  cardPressed: string;
  selected: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  onAccent: string;
  positive: string;
  negative: string;
  warning: string;
  buckets: Record<BucketColor, string>;
}

const dark: Theme = {
  mode: "dark",
  bg: "#0f0f11",
  bgSecondary: "#18181b",
  card: "#1b1b1f",
  cardPressed: "#26262b",
  selected: "#2b2b31",
  border: "#2a2a30",
  borderStrong: "#3a3a42",
  text: "#f4f4f6",
  textMuted: "#9d9da6",
  textFaint: "#6c6c75",
  accent: "#6b73ff",
  onAccent: "#ffffff",
  positive: "#4ade80",
  negative: "#ff6b6b",
  warning: "#fbbf24",
  buckets: { blue: "#6b8cff", green: "#55c08a", amber: "#e0b04a", red: "#e8716f", purple: "#a688f0", pink: "#e67fae", teal: "#4fbfc4", gray: "#8d8d95" },
};

const light: Theme = {
  mode: "light",
  bg: "#f2f2f7",
  bgSecondary: "#e8e8ee",
  card: "#ffffff",
  cardPressed: "#ececf1",
  selected: "#e3e3ea",
  border: "#e1e1e8",
  borderStrong: "#cfcfd8",
  text: "#1b1b1f",
  textMuted: "#66666f",
  textFaint: "#a0a0aa",
  accent: "#4f56e6",
  onAccent: "#ffffff",
  positive: "#1f9d55",
  negative: "#d64545",
  warning: "#c98a0a",
  buckets: { blue: "#3f64e0", green: "#2a9d63", amber: "#c28a14", red: "#d4504e", purple: "#7a58d6", pink: "#cf4f8a", teal: "#1f9ea5", gray: "#77777f" },
};

export const themes = { dark, light };

/** Das Farbschema: nach Wahl in den Einstellungen, sonst das des Systems (Standard dunkel, wenn es keines meldet). */
export function useTheme(): Theme {
  const system = useColorScheme();
  const appearance = usePrefs((s) => s.appearance);
  const mode = appearance === "system" ? (system === "light" ? "light" : "dark") : appearance;
  return mode === "light" ? light : dark;
}

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Seitenrand der Bildschirme */
export const GUTTER = 20;
