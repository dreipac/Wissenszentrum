# Änderungen

## 1.4.0 (29.10.2026)

- Updates: Die App kann beim Start und danach regelmäßig nach einer neuen, signierten Version suchen und sie nach Bestätigung installieren (Banner unten). Beim ersten Start fragt das Onboarding, ob die App automatisch suchen soll („Automatisch“ oder „Aus“); die Wahl lässt sich unter Einstellungen → Info ändern. Bei „Aus“ baut die App von sich aus keine Verbindung auf. Von Hand: „Nach Updates suchen“ oder „Download-Seite öffnen“ und den Installer selbst starten (auch per USB-Stick auf Rechnern ohne Internet).
- Sicherung: Einstellungen → Daten kann alle Daten als Datei speichern und aus einer Sicherungsdatei wiederherstellen. Der bisherige Stand wird vorher gesichert.
- Beim Start nach einem App-Update wird eine ältere Datenbank vor der Migration neben der Datei gesichert (`…vor-update-v<N>.db`). Das galt bisher nur beim Öffnen einer fremden Datei.
- Protokoll: Fehler und unerwartete Abstürze werden in eine Datei geschrieben (Einstellungen → Info → Protokoll).
- Installer: nur noch NSIS (kein MSI mehr). Die Version steht an einer Stelle (`package.json`).
- Datenbankdateien gehören nicht mehr ins Git-Repository.

## 1.3.0

- Stand vor Einführung dieses Changelogs.
