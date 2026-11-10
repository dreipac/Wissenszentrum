# Mobile App (iPhone und Android)

Stand: Phase 1 und eine erste Fassung von Phase 2 stehen im Ordner `mobile/` (Oberfläche mit Beispieldaten, Expo SDK 58). Dieses Dokument hält fest, was gebaut werden soll, womit und in welcher Reihenfolge.

## Umfang

Eine schlanke Begleit-App zum Wissenszentrum für das Telefon, mit **vier Bereichen**:

| Bereich | Inhalt |
|---|---|
| **Dashboard** („Heute“) | Offene und heute fällige Aufgaben, Termine der nächsten 7 Tage, Wichtiges, zuletzt Bearbeitetes |
| **Aufgaben** | Buckets, Priorität, Fälligkeit, Zwischenschritte, abhaken, Aufgaben an Termine gehängt |
| **Kalender** | Monat, Tagesliste, Termin anlegen und bearbeiten (ganztägig, Ort, Beschreibung) |
| **Notizen** | Liste mit Ordnern und Angepinntem, Suche, Notiz lesen und schreiben |

**Nicht dabei:** Dokumentation, Trading, Strategien und der KI-Assistent.

## Vorgehen: Oberfläche zuerst

1. Zuerst die ganze Oberfläche mit **Beispieldaten** (Dummy-Daten), ohne Datenbank und ohne Verbindung zum Desktop.
2. Kompilieren, Datenbank, Abgleich und Veröffentlichung kommen **später**.
3. Die Beispieldaten und Typen folgen dem Schema der Desktop-App (`src-tauri/src/db.rs`), damit die spätere Anbindung kein Umbau wird.

## Technik (Empfehlung)

**Expo mit React Native und TypeScript.**

Warum:
- Dieselbe Sprache und dieselbe Denkweise wie die Desktop-App (React, TypeScript). Typen und Logik für Daten, Kalender und Aufgaben lassen sich übernehmen.
- Wirklich **native Oberfläche** statt einer Webseite im Rahmen: flüssig, mit den Gesten und Elementen, die man von iOS kennt.
- **Vorschau auf dem Telefon von Windows aus:** App „Expo Go“ aus dem App Store, QR-Code scannen, Änderungen erscheinen sofort. Das geht mit Flutter oder Tauri auf einem iPhone ohne Mac nicht.
- **iOS bauen ohne Mac** über die Cloud (EAS Build). Dieselbe Codebasis läuft auf Android.

Verworfen:
- **Flutter:** gut, aber neue Sprache (Dart), kein Expo-Go-Ersatz, iOS-Vorschau braucht einen Mac.
- **Tauri 2 Mobil:** würde die Desktop-Oberfläche wiederverwenden, ist aber eine Webseite im Rahmen und braucht für iOS Xcode auf einem Mac.

### Bausteine
| Zweck | Baustein |
|---|---|
| Navigation | Expo Router (Tabs unten, native Kopfzeilen mit großen Titeln) |
| Listen | FlashList (flüssig auch bei vielen Einträgen) |
| Gesten und Bewegung | Reanimated, Gesture Handler (Wischen zum Abhaken, Sheets) |
| Zustand | Zustand (klein, einfach) |
| Daten (später) | expo-sqlite mit demselben Schema wie am Desktop |
| Symbole | SF Symbols auf iOS (expo-symbols), sonst Lucide |

## Ordner

```
mobile/                  eigenständiges Expo-Projekt im Repo
  app/                   Bildschirme (Dashboard, Aufgaben, Kalender, Notizen)
  src/
    data/                Beispieldaten und „Repository“-Schnittstelle
    theme/               Farben und Abstände (gleiche Tokens wie am Desktop)
    components/          wiederverwendbare Bausteine
    lib/                 Datum, Kalender, Aufgaben (aus dem Desktop übernommen)
```

Die **Repository-Schnittstelle** ist der wichtigste Kniff: Die Oberfläche spricht nur mit `tasksRepo`, `eventsRepo`, `notesRepo`. Zuerst liefern sie Beispieldaten, später SQLite, ohne dass sich die Bildschirme ändern.

## Phasen

| Phase | Ergebnis |
|---|---|
| **0 Entscheidungen** | Framework, Name, Gerät für die Vorschau (siehe „Offene Punkte“) |
| **1 Gerüst** | Expo-Projekt, Tabs, Theme (hell und dunkel), Beispieldaten, Vorschau per QR auf dem Telefon |
| **2 Oberfläche** | Dashboard, Aufgaben, Kalender, Notizen mit allen Zuständen (leer, viele Einträge, lange Titel) und mit Beispieldaten klickbar |
| **3 Gefühl** | Haptik, Animationen, Wischgesten, Pull-to-Refresh, Dunkel und Hell, Tastatur und Sicherheitsbereiche |
| **4 Daten** | SQLite mit Desktop-Schema, Migrationen, echte Speicherung auf dem Telefon |
| **5 Abgleich** | Verbindung zum Desktop (siehe unten, hier liegt die schwierigste Entscheidung) |
| **6 Veröffentlichen** | Bauen mit EAS, TestFlight, App Store und Google Play |

## Abgleich mit dem Desktop (Phase 5)

Das Desktop-Programm gleicht heute **ganze Datenbank-Stände** über einen Ordner ab. Das taugt für das Telefon nicht:
- Das Telefon hat nur einen Teil der Daten (keine Dokumentation, kein Trading). Ein Schreiben des ganzen Standes würde Desktop-Daten überschreiben.
- iOS erlaubt keinen freien Zugriff auf einen OneDrive-Ordner.

Optionen:
1. **Eigenständig, ohne Abgleich** (einfachster Anfang).
2. **Export und Import** per Datei von Hand.
3. **Abgleich je Eintrag** über eine Änderungsliste in einem Cloud-Ordner. Das braucht auf beiden Seiten Änderungszeiten und Löschmarken (heute nicht überall vorhanden) und ist ein eigenes Projekt.
4. **Eigener Server** (zum Beispiel Supabase). Am bequemsten, widerspricht aber dem Gedanken „Daten bleiben lokal“.

Empfehlung: mit 1 starten, später 3.

## Notizen

Am Desktop sind Notizen **HTML** (TipTap). Das Telefon muss sie sauber lesen können. Plan: erst lesen und einfach schreiben, später ein Editor auf TipTap-Basis (zum Beispiel TenTap), damit nichts Formatiertes verloren geht.

## Auf das iPhone bekommen

| Stufe | Wofür | Was man braucht | Kosten |
|---|---|---|---|
| **A: Expo Go** | Entwickeln und Ausprobieren | iPhone, App „Expo Go“ im App Store (Version 58 oder neuer für SDK 58), gleiches WLAN | kostenlos |
| **B: Eigene App auf dem Gerät** | Testen als echte App, TestFlight | Apple Developer Program, Build in der Cloud (EAS), kein Mac nötig | 99 USD pro Jahr |
| **C: App Store** | Veröffentlichen | wie B, dazu Beschreibung, Datenschutzangaben, Screenshots, Prüfung durch Apple | wie B |

Android: Expo Go geht sofort, eine installierbare Datei (APK) ist kostenlos, Google Play kostet einmalig 25 USD.

Hinweis zu Expo Go: Im Frühjahr 2026 hing die App-Store-Version bei SDK 54 fest, und für neuere Versionen brauchte man `eas go` mit einem Apple-Entwicklerkonto. Seit Oktober 2026 zeigt der App-Store-Eintrag Expo Go 58.0.5 mit SDK 58. Fehlt die Version auf dem Telefon, ist der Ausweg `npx eas-cli@latest go` oder ein Development Build (beides braucht das Apple Developer Programm).

Hinweis: Die Zahlen zu Gebühren und zu den Gratis-Bauten bei EAS stammen aus Drittquellen und sind vor einer Entscheidung auf den offiziellen Seiten zu prüfen.

## Offene Punkte

- **Geräte:** Ist ein iPhone für die Vorschau da? Gibt es ein Android-Gerät?
- **Name und Kennung:** zum Beispiel „Wissenszentrum“ mit `com.armin.wissenszentrum.mobile`.
- **Abgleich:** Start eigenständig (empfohlen) oder gleich mit Desktop-Verbindung?
- **Schreibe-Funktionen in Phase 2:** Aufgaben und Termine anlegen und ändern gleich mit Beispieldaten klickbar machen (empfohlen), oder zuerst nur Ansehen?
