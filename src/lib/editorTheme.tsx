import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useAppTheme } from "./appTheme";

/** Farbschema der Editoren (Notizen und Dokumentation). Ohne eigene Wahl folgt es dem Schema der App. */
export type EditorTheme = "dark" | "light";

const KEY = "editorTheme";

/** Die eigene Wahl für die Schreibfläche, oder null, wenn sie der App folgt. */
function read(): EditorTheme | null {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

interface EditorThemeValue {
  theme: EditorTheme;
  setTheme: (theme: EditorTheme) => void;
  /** Die Schreibfläche hat ein eigenes Schema, das vom Schema der App abweichen darf */
  custom: boolean;
  /** Zurück zu „wie die App“ */
  followApp: () => void;
}

const EditorThemeContext = createContext<EditorThemeValue>({ theme: "dark", setTheme: () => undefined, custom: false, followApp: () => undefined });

/**
 * Hält die Wahl für das ganze Fenster. Sie gilt je Rechner und wird im Browser-Speicher des Programms abgelegt
 * (es ist eine Darstellungseinstellung, kein Inhalt, und gehört damit nicht in den Abgleich zwischen Rechnern).
 */
export function EditorThemeProvider({ children }: { children: ReactNode }) {
  const { theme: appTheme } = useAppTheme();
  const [chosen, setChosen] = useState<EditorTheme | null>(read);

  const remember = (value: EditorTheme | null) => {
    try {
      if (value) localStorage.setItem(KEY, value);
      else localStorage.removeItem(KEY);
    } catch {
      /* Merken ist nur Komfort */
    }
  };

  const setTheme = useCallback((next: EditorTheme) => {
    setChosen(next);
    remember(next);
  }, []);

  const followApp = useCallback(() => {
    setChosen(null);
    remember(null);
  }, []);

  const value = useMemo(() => ({ theme: chosen ?? appTheme, setTheme, custom: chosen !== null, followApp }), [chosen, appTheme, setTheme, followApp]);
  return <EditorThemeContext.Provider value={value}>{children}</EditorThemeContext.Provider>;
}

export const useEditorTheme = () => useContext(EditorThemeContext);
