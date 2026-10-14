// Im normalen Betrieb läuft alles über die SQLite-Datenbank im Tauri-Backend.
// Nur im reinen Browser-Preview (npm run dev ohne Tauri-Fenster) gibt es keinen
// Backend-Zugriff – dort ersetzt ein In-Memory-Speicher die Datenbank.
export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
