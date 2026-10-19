import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** Farbschema der Editoren (Notizen und Dokumentation). Die übrige App bleibt dunkel. */
export type EditorTheme = "dark" | "light";

const KEY = "editorTheme";

function read(): EditorTheme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

interface EditorThemeValue {
  theme: EditorTheme;
  setTheme: (theme: EditorTheme) => void;
}

const EditorThemeContext = createContext<EditorThemeValue>({ theme: "dark", setTheme: () => undefined });

/**
 * Hält die Wahl für das ganze Fenster. Sie gilt je Rechner und wird im Browser-Speicher des Programms abgelegt
 * (es ist eine Darstellungseinstellung, kein Inhalt, und gehört damit nicht in den Abgleich zwischen Rechnern).
 */
export function EditorThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<EditorTheme>(read);

  const setTheme = useCallback((next: EditorTheme) => {
    setThemeState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* Merken ist nur Komfort */
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <EditorThemeContext.Provider value={value}>{children}</EditorThemeContext.Provider>;
}

export const useEditorTheme = () => useContext(EditorThemeContext);
