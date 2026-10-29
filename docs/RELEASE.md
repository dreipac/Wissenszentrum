# Release-Anleitung

Ein Release entsteht aus einem Git-Tag. GitHub Actions baut den Installer, signiert das Update und legt ein Release als **Entwurf** an. Die App auf den Rechnern der Nutzer findet das Update danach selbst.

## Einmalig einrichten

### 1. Secrets für die Update-Signatur (Pflicht)

Updates sind mit einem eigenen Schlüsselpaar signiert. Die App prüft die Signatur mit dem öffentlichen Schlüssel aus `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). Ein Update ohne passende Signatur lehnt sie ab.

Der private Schlüssel liegt **nicht** im Repo. Er wurde mit `npx tauri signer generate` erzeugt und liegt auf dem Entwicklungsrechner:

| Datei | Inhalt |
|---|---|
| `~/.tauri/wissenszentrum.key` | privater Schlüssel |
| `~/.tauri/wissenszentrum.key.password.txt` | Passwort dazu |
| `~/.tauri/wissenszentrum.key.pub` | öffentlicher Schlüssel (steht schon in `tauri.conf.json`) |

Auf GitHub unter *Settings → Secrets and variables → Actions* zwei Secrets anlegen:

| Secret | Wert |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | kompletter Inhalt von `wissenszentrum.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Inhalt von `wissenszentrum.key.password.txt` |

> **Den privaten Schlüssel sichern** (Passwortmanager, zweiter Datenträger). Geht er verloren, kann keine installierte App mehr aktualisiert werden: alle Nutzer müssten einmal von Hand neu installieren. Wird er öffentlich, muss er ersetzt werden (neues Paar erzeugen, `pubkey` ändern, neue Version von Hand verteilen).

### 2. Windows-Code-Signing (empfohlen, optional)

Ohne Zertifikat zeigt Windows SmartScreen beim Installieren „Unbekannter Herausgeber“. Der Release läuft trotzdem durch, der Installer ist dann nur nicht signiert. Das Zertifikat selbst kostet Geld und muss von dir beschafft werden (Standard-/EV-Code-Signing-Zertifikat einer Zertifizierungsstelle; Azure Trusted Signing braucht eine andere Einrichtung als hier beschrieben).

Mit einem `.pfx`-Zertifikat zwei weitere Secrets anlegen:

| Secret | Wert |
|---|---|
| `WINDOWS_CERTIFICATE` | Inhalt der `.pfx` als Base64: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("zertifikat.pfx"))` |
| `WINDOWS_CERTIFICATE_PASSWORD` | Passwort der `.pfx` |

Der Workflow importiert das Zertifikat selbst und signiert Installer und Programm.

## Ein Release veröffentlichen

1. Version erhöhen (setzt `package.json`, `package-lock.json`, `Cargo.toml` und `Cargo.lock` gemeinsam; `tauri.conf.json` liest sie aus `package.json`):
   ```bash
   npm run version:set 1.4.0
   ```
2. `CHANGELOG.md` ergänzen.
3. Committen und den Tag setzen und pushen:
   ```bash
   git commit -am "Version 1.4.0"
   git tag v1.4.0
   git push origin main v1.4.0
   ```
4. Der Workflow **Release** prüft, ob Tag und Version übereinstimmen, testet das Backend, baut den Installer und lädt hoch:
   - `Wissenszentrum_1.4.0_x64-setup.exe` (Installer)
   - `…-setup.exe.sig` (Signatur des Updates)
   - `latest.json` (Beschreibung, die der Updater abruft)
5. Das Release erscheint auf GitHub als **Entwurf**. Den Installer herunterladen, auf einem sauberen Windows-Konto installieren und kurz ausprobieren. Danach *Publish release*.

Der Installer aus dem Release funktioniert auch ohne Updater: Wer die automatische Suche ausgeschaltet hat oder offline arbeitet, lädt ihn von der Release-Seite und startet ihn über die bestehende Installation hinweg (gleiche Kennung, die Daten bleiben erhalten).

Erst mit dem Veröffentlichen sehen installierte Apps das Update, denn der Updater liest `https://github.com/dreipac/Wissenszentrum/releases/latest/download/latest.json` und das gilt nur für veröffentlichte Releases.

## Vor jedem Release prüfen

- [ ] Auf einer **Kopie echter Daten** von der letzten veröffentlichten Version auf die neue aktualisieren. Prüfen, dass alles da ist und neben der Datenbank eine Datei `…vor-update-v<N>.db` liegt, falls das Schema geändert wurde.
- [ ] Sicherung speichern und wiederherstellen (Einstellungen → Daten).
- [ ] *Einstellungen → Info → Nach Updates suchen* von der **vorigen** Version aus: Das Update wird gefunden, geladen und installiert.
- [ ] Installation auf einem Windows-Konto ohne die Entwicklungswerkzeuge (WebView2 wird bei Bedarf vom Installer nachgeladen).

## Neue Migration (Schema ändern)

Neue Einträge kommen ans Ende von `MIGRATIONS` in `src-tauri/src/db.rs`, bestehende werden nie geändert. Beim Start sichert die App eine ältere Datenbank automatisch neben der Datei, bevor sie migriert. Ein Test dazu steht in `profile.rs` (`start_after_app_update_backs_up_before_migrating`).

## Fehlersuche

- **Protokoll:** *Einstellungen → Info → Protokoll → Ordner öffnen* (Datei `wissenszentrum.log`, `%LOCALAPPDATA%\com.armin.wissenszentrum\logs`). Abstürze stehen dort mit Ort im Code.
- **Update wird nicht gefunden:** Ist das Release veröffentlicht (kein Entwurf)? Gehört `latest.json` zum Release? Steht in `latest.json` eine höhere Version als die installierte?
- **„Signatur ungültig“:** Release wurde mit einem anderen privaten Schlüssel signiert als dem, zu dem `pubkey` in `tauri.conf.json` gehört.
