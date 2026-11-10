# Wissenszentrum Mobil

Begleit-App für iPhone und Android mit **Dashboard, Aufgaben, Kalender und Notizen**. Plan und Hintergründe: [`docs/MOBILE.md`](../docs/MOBILE.md).

Stand: Oberfläche mit **Beispieldaten** (nichts wird gespeichert, kein Abgleich mit dem Desktop).

## Starten

```bash
cd mobile
npm install
npx expo start
```

Im Terminal erscheint ein **QR-Code**. Auf dem iPhone mit der Kamera scannen, dann öffnet sich die App „Expo Go“ und lädt die App. Telefon und Rechner müssen im selben WLAN sein.

- Ist Expo Go nicht installiert: App Store → „Expo Go“. Die App muss **SDK 58** unterstützen (Version 58 oder neuer).
- Klappt das WLAN nicht: `npx expo start --tunnel`.
- Vorschau im Browser am Rechner: im Terminal `w` drücken (Web). Das ist eine Annäherung ohne Haptik und ohne die echte Tab-Leiste.

## Bildschirmfoto vom Telefon (nur Entwicklung)

In Expo Go genügt es, auf einem beliebigen Bildschirm den **Titel lange zu drücken** (etwa eine Sekunde); alternativ gibt es in den Einstellungen unter „Entwicklung“ eine Taste dafür. Das nimmt den Bildschirm auf und schickt ihn über das WLAN an den Entwicklungsserver auf dem Rechner (`metro.config.js`, Ordner `mobile/.screenshots`, das neueste Bild heißt `latest.jpg`). So lässt sich zeigen, wie die App auf dem iPhone aussieht, ohne Bilder zu übertragen. Das gibt es nur in der Entwicklung (`__DEV__`) und nicht im Web.

## Aufbau

```
src/app/          Bildschirme (Expo Router): (tabs)/(home), tasks, calendar, notes, dazu new-task und new-event
src/components/   Bausteine (ui/ für Text, Symbole, Karten, Chips …), Zeilen, Formulare, Monatsraster
src/data/         Typen, Beispieldaten, Repository-Schnittstelle, Store (Zustand)
src/lib/          Datum, Aufgaben, Kalender, Notizen (aus der Desktop-App übernommen)
src/theme/        Farben und Maße (gleiche Tokens wie am Desktop), hell und dunkel nach System
```

Die Oberfläche spricht nur mit dem Store, und der nur mit `Repository` (`src/data/repository.ts`). Heute liefert `memoryRepository` Beispieldaten, später kommt SQLite dazu.

## Prüfen

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
```
