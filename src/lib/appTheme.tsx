import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** Farbschema der ganzen App. Die Schreibfläche in Notizen und Dokumentation folgt ihm, solange man dort nichts anderes wählt. */
export type AppTheme = "dark" | "light";

const KEY = "appTheme";

export function readAppTheme(): AppTheme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Setzt das Schema auf der Wurzel des Dokuments; die Farbwerte stehen in styles/tokens.css. */
export function applyAppTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
}

interface AppThemeValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
}

const AppThemeContext = createContext<AppThemeValue>({ theme: "dark", setTheme: () => undefined });

/**
 * Hält die Wahl für das ganze Fenster. Sie gilt je Rechner und liegt im Browser-Speicher des Programms (eine
 * Darstellungseinstellung, kein Inhalt, und gehört damit nicht in den Abgleich zwischen Rechnern).
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(readAppTheme);

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next);
    applyAppTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* Merken ist nur Komfort */
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export const useAppTheme = () => useContext(AppThemeContext);
