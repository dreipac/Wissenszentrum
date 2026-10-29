# Wissenszentrum

Desktop-App für Windows: Dokumentation, Aufgaben, Kalender, Notizen, Trading und Strategien an einem Ort, dazu ein KI-Assistent, der Vorschläge macht und erst nach Bestätigung etwas ändert. Alle Daten liegen in einer lokalen SQLite-Datei; zwischen Rechnern lässt sich über einen gemeinsamen Ordner (z. B. OneDrive) abgleichen.

**Stack:** Tauri 2 (Rust) · React 19 · TypeScript · Vite · TipTap · SQLite (`rusqlite`)

## Entwickeln

Voraussetzungen: [Node.js](https://nodejs.org) 22+, [Rust](https://rustup.rs) (stable) und die [Tauri-Voraussetzungen für Windows](https://tauri.app/start/prerequisites/) (WebView2, Visual Studio Build Tools).

```bash
npm install
npm run tauri dev      # App mit Hot Reload
npm run dev            # nur das Frontend im Browser (mit Beispieldaten, ohne Datenbank)
```

Prüfen:

```bash
npm run build                                        # TypeScript prüfen und Frontend bauen
cargo test --manifest-path src-tauri/Cargo.toml --lib  # Backend-Tests
npm run version:check                                # Versionen in allen Dateien gleich?
```

Installer bauen (lokal, ohne Release):

```bash
npm run tauri build
```

Wird dabei `createUpdaterArtifacts` ausgewertet, braucht der Build die Umgebungsvariablen `TAURI_SIGNING_PRIVATE_KEY` und `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (siehe [docs/RELEASE.md](docs/RELEASE.md)).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `src/views/` | Hauptansichten (Dashboard, Aufgaben, Kalender, Notizen, Dokumentation, Trading, Strategien) |
| `src/components/` | Oberfläche je Bereich, dazu `ui/` mit den gemeinsamen Bausteinen |
| `src/lib/api/` | Aufrufe ans Backend; mit `*Preview.ts` als Ersatz im Browser ohne Tauri |
| `src/lib/use*.ts` | Hooks, die Daten pro Bereich laden und halten |
| `src-tauri/src/` | Backend: je Bereich ein Modul (`tasks.rs`, `docs.rs`, `trading.rs`, …) |
| `src-tauri/src/db.rs` | Datenbankschema als Liste von Migrationen (nur anhängen, nie ändern) |
| `src-tauri/src/sync.rs` | Abgleich zwischen Rechnern, auch Export und Wiederherstellung von Sicherungen |
| `scripts/version.mjs` | Version in allen Dateien setzen und prüfen |

## Daten und Sicherheit

- Die Datenbank liegt dort, wo man sie beim ersten Start gewählt hat. Sie ist nicht verschlüsselt.
- Der Anthropic-API-Key des Assistenten liegt im Windows-Schlüsselspeicher, nicht in der Datenbank. Der Finnhub-Key steht in der Datenbank, wird aber nie abgeglichen oder in Sicherungen geschrieben.
- Sicherungen entstehen automatisch vor dem Laden eines fremden Standes, vor dem Wiederherstellen und vor dem Aktualisieren einer älteren Datenbank. Manuell: *Einstellungen → Daten*.
- Die Datenbankdatei gehört nicht ins Repository (`*.db` steht in `.gitignore`).
- Der Assistent schickt Auszüge der Daten an Anthropic, die Kursabfrage Symbole an Finnhub. Beides nur, wenn ein Key eingetragen ist.
- Die App läuft vollständig ohne Internet. Die Suche nach Updates ist standardmäßig an und lässt sich unter *Einstellungen → Info* auf „Aus“ stellen (die Frage kommt auch im Onboarding); sie überträgt keine Daten aus der Datenbank. Wer offline arbeitet, lädt den Installer von der Release-Seite auf einem anderen Rechner und startet ihn von Hand (die Daten bleiben erhalten).

## Releases

Siehe [docs/RELEASE.md](docs/RELEASE.md). Kurz: `npm run version:set <x.y.z>`, committen, Tag `v<x.y.z>` pushen. Der Rest läuft in GitHub Actions; installierte Apps aktualisieren sich danach selbst.
