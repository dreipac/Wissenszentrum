# Änderungen

## 1.5.0 (10.11.2026)

- Aufgaben: Buckets lassen sich zuklappen (Pfeil vor dem Namen, auch „Ohne Bucket“). Dabei fährt die Spalte kurz zusammen und die Aufgaben blenden aus; beim Aufklappen gleiten sie nacheinander herein. Welche Buckets zu sind, merkt sich die App. Zieht man eine Aufgabe über einen zugeklappten Bucket, erscheint dort eine Fläche zum Ablegen.
- Kalender: Die zuletzt gewählte Ansicht (Tag, Arbeitswoche, Woche, Monat) bleibt beim nächsten Öffnen erhalten.
- Dokumentation, Tabellen: Die Werkzeugleiste hat nur noch einen Löschen-Knopf, ganz rechts. Er löscht das Markierte (ganze Zeilen, ganze Spalten, die ganze Tabelle oder den Inhalt markierter Zellen); ohne Markierung ist er ausgegraut. Entf oder Rücktaste löschen markierte Zeilen, Spalten oder die Tabelle ebenso.
- Assistent, Verbindung: Bricht ein großer Upload sofort ab (Windows-Fehler wie 10054 oder „Nachricht wurde geändert“), versucht die App es bis zu viermal. Scheitert alles, prüft sie mit einer kostenlosen kleinen Anfrage, ob der Server erreichbar ist, und nennt das Ergebnis in der Meldung.
- Assistent, Modellwahl und Kosten: Neue Betriebsart „Auto“ (Standard). Haiku antwortet auf einfache Fragen, Sonnet übernimmt Aufträge wie Lösen, Schreiben, Gliedern und Seiten aufbauen sowie lange Texte und laufende Sonnet-Arbeit; kommt Haiku bei den Werkzeugen wiederholt nicht zurecht, wiederholt die App die Antwort selbst mit Sonnet. Opus ist entfernt (wer es gewählt hatte, bekommt „Auto“). Unter jeder Antwort steht jetzt das Modell und eine Kostenschätzung in Franken; in den Einstellungen lassen sich ein Kostenlimit je Antwort (Standard 1 Franken, 0 = keines) und der Wechselkurs einstellen. Ist das Limit erreicht, hält der Assistent an und liefert, was bis dahin entstanden ist.
- Assistent, größere Aufträge: Bei Aufträgen mit mehreren Teilen legt der Assistent sich einen Arbeitsplan an (Aufgabenliste im Chat, hakt sich live ab) und arbeitet ihn Schritt für Schritt ab. Große Seitenvorschläge baut er in vielen kleinen Aufrufen auf und behält dabei einen einzigen Vorschlag, den du am Ende bestätigst; so bricht nichts mehr beim Ausgabelimit ab. Wird eine Antwort doch abgeschnitten, bittet die App den Assistenten einmal selbst, kleiner zu arbeiten. Mit „Stopp“ unterbrichst du die Arbeit, und es bleibt, was bis dahin entstanden ist. Eine Bremse beendet Läufe mit sehr großer Ausgabe von selbst.
- Assistent, Verbindung: Bricht die Verbindung zu Anthropic ab, nennt die Meldung jetzt die Ursache und wie lange es bis dahin dauerte, und das Protokoll hält es fest. Scheitert das Senden sofort, versucht die App es einmal selbst erneut; TCP-Lebenszeichen halten die Verbindung bei langen Antworten offen.
- Assistent: Die Antwort darf bis zu 16.384 Token lang werden (vorher 8.192), damit große Seitenvorschläge nicht mehr abbrechen; das Zeitlimit je Antwort steigt auf 5 Minuten.
- Assistent: Dateien bleiben mit ihrem Inhalt im Gespräch und im Zwischenspeicher, nicht nur bei der nächsten Nachricht (bis 10 MB zusammen, bei Platzmangel weichen die ältesten zuerst; dieselbe Datei, die mehrfach angehängt wurde, geht nur einmal mit). Der Verlauf kürzt sich in Zehnerschritten statt bei jeder Frage, damit der Zwischenspeicher weiter trifft; ein Verlauf über 20 Nachrichten brach vorher mit „Es fehlt eine Frage“ ab, wenn er mit einer Antwort begann.
- Assistent, Kosten: Der feste Teil jeder Anfrage (Werkzeuge und Anweisungen) wird jetzt eine Stunde zwischengespeichert und bei Folgefragen günstig wiedergelesen. Dafür steht im Systemtext nur noch das Datum; die Uhrzeit holt sich der Assistent bei Bedarf über ein eigenes Werkzeug. Einstellungen → Assistent zeigt den Verbrauch seit dem Start (Anfragen, Trefferquote des Zwischenspeichers, Tokens); das Protokoll hält jede Anfrage fest.
- Assistent: Lehnt ein Modell die Aufwandsstufe oder den Zwischenspeicher ab, bleibt nur dieses Feld weg und wird gemerkt; bisher fiel bei jedem Fehler 400 stillschweigend beides weg. Andere Fehler (zum Beispiel leeres Guthaben) werden nicht mehr unnötig wiederholt.
- Assistent: Dateien lassen sich an eine Nachricht hängen (Büroklammer, Ziehen oder Einfügen; bis zu 5). Der Assistent liest Bilder, PDF, Text- und Word-Dateien und schlägt vor, die Datei auf einer neuen oder bestehenden Seite der Dokumentation abzulegen. Abgelegt wird erst nach Bestätigung; die Datei liegt als Anhang in der Datenbank.

## 1.4.1 (02.11.2026)

- Release Script erstellt
- Datenbankdateien aus dem Git-Index entfernen

## 1.4.0 (29.10.2026)

- Updates: Die App kann beim Start und danach regelmäßig nach einer neuen, signierten Version suchen und sie nach Bestätigung installieren (Banner unten). Beim ersten Start fragt das Onboarding, ob die App automatisch suchen soll („Automatisch“ oder „Aus“); die Wahl lässt sich unter Einstellungen → Info ändern. Bei „Aus“ baut die App von sich aus keine Verbindung auf. Von Hand: „Nach Updates suchen“ oder „Download-Seite öffnen“ und den Installer selbst starten (auch per USB-Stick auf Rechnern ohne Internet).
- Sicherung: Einstellungen → Daten kann alle Daten als Datei speichern und aus einer Sicherungsdatei wiederherstellen. Der bisherige Stand wird vorher gesichert.
- Beim Start nach einem App-Update wird eine ältere Datenbank vor der Migration neben der Datei gesichert (`…vor-update-v<N>.db`). Das galt bisher nur beim Öffnen einer fremden Datei.
- Protokoll: Fehler und unerwartete Abstürze werden in eine Datei geschrieben (Einstellungen → Info → Protokoll).
- Installer: nur noch NSIS (kein MSI mehr). Die Version steht an einer Stelle (`package.json`).
- Datenbankdateien gehören nicht mehr ins Git-Repository.

## 1.3.0

- Stand vor Einführung dieses Changelogs.
