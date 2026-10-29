import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Database, Download, Info, LineChart, Palette, RefreshCw, Sparkles, Upload, User, X, type LucideIcon } from "lucide-react";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Logo } from "../ui/Logo";
import { SecondaryButton } from "../ui/SecondaryButton";
import { exportBackup, pickBackupFile, restoreBackup } from "../../lib/api/app";
import { appVersion, openDownloadPage, openLogFolder } from "../../lib/api/updater";
import { useUpdater } from "../../lib/useUpdater";
import { ASSISTANT_MODELS, assistantStatus, saveAssistantKey, setAssistantModel, type AssistantStatus } from "../../lib/api/assistant";
import { getApiKey, saveApiKey } from "../../lib/api/trading";
import { useAppTheme, type AppTheme } from "../../lib/appTheme";
import { useEditorTheme, type EditorTheme } from "../../lib/editorTheme";
import { useProfile } from "../../lib/profile";
import { OPEN_CONFLICT_EVENT } from "../sync/SyncBanner";
import { SyncSection } from "../sync/SyncSection";
import "../ui/Modal.css";
import "./Settings.css";

export type SettingsSection = "profile" | "appearance" | "data" | "sync" | "assistant" | "trading" | "about";

interface SectionInfo {
  id: SettingsSection;
  label: string;
  title: string;
  lead: string;
  icon: LucideIcon;
}

const SECTIONS: SectionInfo[] = [
  { id: "profile", label: "Profil", title: "Profil", lead: "So wirst du in der App angesprochen.", icon: User },
  { id: "appearance", label: "Darstellung", title: "Darstellung", lead: "Hell oder dunkel: für die ganze App und die Schreibfläche in Notizen und Dokumentation.", icon: Palette },
  { id: "data", label: "Daten", title: "Daten und Speicherort", lead: "Wo deine Inhalte liegen.", icon: Database },
  { id: "sync", label: "Abgleich", title: "Abgleich zwischen Rechnern", lead: "Zuhause und unterwegs mit demselben Stand arbeiten.", icon: RefreshCw },
  { id: "assistant", label: "Assistent", title: "Assistent", lead: "Fragen an deine Daten, beantwortet von einem KI-Modell.", icon: Sparkles },
  { id: "trading", label: "Trading", title: "Trading", lead: "Kursdaten für Aktien und Krypto.", icon: LineChart },
  { id: "about", label: "Info", title: "Info und Kurzbefehle", lead: "Version und Tastenkombinationen.", icon: Info },
];

interface RowProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}

/** Eine Einstellung: links Name und Erklärung, rechts das Bedienelement. */
function Row({ label, hint, htmlFor, children }: RowProps) {
  return (
    <div className="st-row">
      <div className="st-row-text">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <span>{hint}</span>}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="st-group">
      {title && <h3>{title}</h3>}
      <div className="st-card">{children}</div>
    </section>
  );
}

/** Rückmeldung nach dem Speichern, blendet sich nach kurzer Zeit aus. */
function useFlash() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [
    message,
    (text: string | null) => {
      window.clearTimeout(timer.current);
      setMessage(text);
      if (text) timer.current = window.setTimeout(() => setMessage(null), 2600);
    },
  ] as const;
}

function ProfileSection() {
  const profile = useProfile();
  const [first, setFirst] = useState(profile.firstName);
  const [last, setLast] = useState(profile.lastName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();
  const dirty = first.trim() !== profile.firstName || last.trim() !== profile.lastName;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await profile.update(first, last);
      setFlash("Gespeichert");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="st-identity">
        <span className="avatar st-avatar">{profile.initials}</span>
        <div>
          <strong>{profile.fullName}</strong>
          <span>Lokaler Arbeitsbereich</span>
        </div>
      </div>
      <Group title="Name">
        <Row label="Vorname" htmlFor="st-first">
          <input id="st-first" className="field-control" value={first} maxLength={60} onChange={(e) => setFirst(e.target.value)} onKeyDown={(e) => e.key === "Enter" && dirty && void save()} />
        </Row>
        <Row label="Nachname" htmlFor="st-last">
          <input id="st-last" className="field-control" value={last} maxLength={60} onChange={(e) => setLast(e.target.value)} onKeyDown={(e) => e.key === "Enter" && dirty && void save()} />
        </Row>
      </Group>
      <div className="st-actions">
        {flash && (
          <span className="st-flash">
            <Check size={14} /> {flash}
          </span>
        )}
        {dirty && (
          <SecondaryButton
            onClick={() => {
              setFirst(profile.firstName);
              setLast(profile.lastName);
              setError(null);
            }}
          >
            Zurücksetzen
          </SecondaryButton>
        )}
        <Button disabled={busy || !dirty} onClick={() => void save()}>
          Speichern
        </Button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

const APP_THEMES: { id: AppTheme; label: string; hint: string }[] = [
  { id: "dark", label: "Dunkel", hint: "Ruhig bei wenig Licht" },
  { id: "light", label: "Hell", hint: "Klar und hell" },
];

const THEMES: { id: EditorTheme; label: string; hint: string }[] = [
  { id: "dark", label: "Dunkel", hint: "Dunkle Schreibfläche" },
  { id: "light", label: "Hell", hint: "Wie Papier, gut für lange Texte" },
];

/** Kleines Fenster der App im jeweiligen Schema: Leiste, Titel, zwei Karten. Nutzt die echten Farbwerte des Schemas. */
function AppPreview({ theme }: { theme: AppTheme }) {
  return (
    <span className="st-theme-app" data-editor-theme={theme} aria-hidden="true">
      <span className="st-app-side">
        <i className="on" />
        <i />
        <i />
        <i />
      </span>
      <span className="st-app-main">
        <i className="st-pv-title" />
        <span className="st-app-cards">
          <span>
            <i />
            <i />
          </span>
          <span>
            <i />
            <i />
          </span>
        </span>
        <i className="st-pv-line" />
      </span>
    </span>
  );
}

/** Kleine Seite im jeweiligen Schema: Überschrift, Text, Tabelle. Nutzt die echten Farbwerte des Schemas. */
function ThemePreview({ theme }: { theme: EditorTheme }) {
  return (
    <span className="st-theme-page" data-editor-theme={theme} aria-hidden="true">
      <i className="st-pv-title" />
      <i className="st-pv-line" style={{ width: "92%" }} />
      <i className="st-pv-line" style={{ width: "78%" }} />
      <span className="st-pv-table">
        <i />
        <i />
        <i />
        <i />
      </span>
      <i className="st-pv-line" style={{ width: "58%" }} />
    </span>
  );
}

function AppearanceSection() {
  const { theme, setTheme, custom, followApp } = useEditorTheme();
  const app = useAppTheme();
  return (
    <>
      <Group title="App">
        <div className="st-pad st-theme-block">
          <div className="st-row-text">
            <span className="st-what">Farbschema der App</span>
          </div>
          <div className="st-themes" role="radiogroup" aria-label="Farbschema der App">
            {APP_THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={app.theme === t.id} className={`st-theme${app.theme === t.id ? " active" : ""}`} onClick={() => app.setTheme(t.id)}>
                <AppPreview theme={t.id} />
                <span className="st-theme-label">
                  <span className="st-theme-radio" aria-hidden="true" />
                  <strong>{t.label}</strong>
                  <small>{t.hint}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      </Group>

      <Group title="Editor">
        <div className="st-pad st-theme-block">
          <div className="st-row-text">
            <span className="st-what">Farbe der Schreibfläche</span>
          </div>
          <div className="st-themes" role="radiogroup" aria-label="Farbe der Schreibfläche">
            {THEMES.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={theme === t.id} className={`st-theme${theme === t.id ? " active" : ""}`} onClick={() => setTheme(t.id)}>
                <ThemePreview theme={t.id} />
                <span className="st-theme-label">
                  <span className="st-theme-radio" aria-hidden="true" />
                  <strong>{t.label}</strong>
                  <small>{t.hint}</small>
                </span>
              </button>
            ))}
          </div>
          <p className="st-theme-note">
            {custom ? "Die Schreibfläche hat ein eigenes Schema." : "Die Schreibfläche folgt dem Schema der App."}
            {custom && (
              <button type="button" className="st-link" onClick={followApp}>
                Wie die App
              </button>
            )}
          </p>
        </div>
      </Group>
    </>
  );
}

function DataSection() {
  const profile = useProfile();
  const [flash, setFlash] = useFlash();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restorePath, setRestorePath] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(profile.dbPath ?? "");
      setFlash("Pfad kopiert");
    } catch {
      setFlash("Kopieren nicht möglich");
    }
  };

  const exportNow = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await exportBackup();
      if (path) setFlash("Sicherung gespeichert");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseRestore = async () => {
    setError(null);
    try {
      const path = await pickBackupFile();
      if (path) setRestorePath(path);
    } catch (e) {
      setError(String(e));
    }
  };

  const restoreNow = async () => {
    if (!restorePath) return;
    setBusy(true);
    setError(null);
    try {
      await restoreBackup(restorePath);
      // Alle Ansichten halten noch den alten Stand im Speicher: Neuladen ist der sichere Weg
      window.location.reload();
    } catch (e) {
      setError(String(e));
      setRestorePath(null);
      setBusy(false);
    }
  };

  return (
    <>
      <Group title="Datenbank">
        <Row label="Speicherort" hint="Alle Aufgaben, Notizen, Seiten, Bilder und Trades liegen in dieser einen Datei.">
          <div className="st-path">
            <span title={profile.dbPath ?? ""}>{profile.dbPath ?? "—"}</span>
            <button type="button" className="icon-btn" aria-label="Pfad kopieren" title="Pfad kopieren" onClick={() => void copy()}>
              <Copy size={14} />
            </button>
          </div>
        </Row>
        {flash && (
          <div className="st-row compact">
            <span className="st-flash">
              <Check size={14} /> {flash}
            </span>
          </div>
        )}
      </Group>
      <Group title="Sicherung">
        <Row label="Sicherung speichern" hint="Eine Kopie aller Daten als einzelne Datei, zum Beispiel auf einem USB-Stick oder in der Cloud. Der Finnhub-Key ist nicht enthalten.">
          <SecondaryButton disabled={busy} onClick={() => void exportNow()}>
            <Download size={14} /> Speichern …
          </SecondaryButton>
        </Row>
        <Row label="Sicherung wiederherstellen" hint="Ersetzt alle Daten durch den Stand einer Sicherungsdatei. Den jetzigen Stand sichert die App vorher automatisch.">
          <SecondaryButton disabled={busy} onClick={() => void chooseRestore()}>
            <Upload size={14} /> Datei wählen …
          </SecondaryButton>
        </Row>
      </Group>
      {error && <p className="field-error">{error}</p>}
      {restorePath && (
        <ConfirmDialog
          title="Sicherung wiederherstellen?"
          message={`Alle jetzigen Daten werden durch den Stand aus „${restorePath}“ ersetzt. Den jetzigen Stand legt die App vorher im Ordner „sicherungen“ im Datenordner der App ab. Danach lädt die App neu.`}
          confirmLabel="Wiederherstellen"
          busy={busy}
          onConfirm={() => void restoreNow()}
          onCancel={() => setRestorePath(null)}
        />
      )}
      <Group title="Hinweise">
        <div className="st-note">
          <p>Die Daten liegen nur auf diesem Rechner und sind nicht verschlüsselt. Für denselben Stand auf einem zweiten Rechner nutze den Bereich „Abgleich“.</p>
          <p>Vor dem Laden eines fremden Stands und vor dem Wiederherstellen legt die App automatisch eine Sicherung im Datenordner der App an (AppData, Ordner „sicherungen“). Vor dem Aktualisieren einer älteren Datenbank entsteht eine Kopie neben der Datenbankdatei („…vor-update-v…“).</p>
        </div>
      </Group>
    </>
  );
}

function SyncPanel({ onClose }: { onClose: () => void }) {
  return (
    <Group>
      <div className="st-pad">
        <SyncSection
          bare
          onResolve={() => {
            onClose();
            window.dispatchEvent(new Event(OPEN_CONFLICT_EVENT));
          }}
        />
      </div>
    </Group>
  );
}

function AssistantSection() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();

  useEffect(() => {
    assistantStatus()
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);

  const changeKey = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await saveAssistantKey(value);
      setKey("");
      setStatus(await assistantStatus());
      setFlash(value.trim() ? "Key geprüft und gespeichert" : "Key entfernt");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseModel = async (model: string) => {
    setError(null);
    try {
      await setAssistantModel(model);
      setStatus((s) => (s ? { ...s, model } : s));
      setFlash("Modell geändert");
    } catch (e) {
      setError(String(e));
    }
  };

  const current = ASSISTANT_MODELS.find((m) => m.id === status?.model) ?? ASSISTANT_MODELS[0];

  return (
    <>
      <Group title="Anbindung">
        <Row label="Anthropic API-Key" hint="Aus der Anthropic Console (console.anthropic.com). Die Abrechnung läuft über dein Konto dort, nach Verbrauch." htmlFor="st-anthropic">
          <input
            id="st-anthropic"
            type="password"
            className="field-control"
            value={key}
            placeholder={status?.hasKey ? "Key gespeichert, zum Ersetzen neuen einfügen" : "sk-ant-…"}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setKey(e.target.value);
              setFlash(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && key.trim() && !busy && void changeKey(key)}
          />
        </Row>
        <div className="st-row compact">
          <span className="st-hint">Der Key liegt verschlüsselt im Windows-Schlüsselspeicher dieses Benutzers, nicht in der Datenbank. Er wird nicht abgeglichen und muss auf jedem Rechner neu eingetragen werden.</span>
        </div>
      </Group>
      <div className="st-actions">
        {flash && (
          <span className="st-flash">
            <Check size={14} /> {flash}
          </span>
        )}
        {status?.hasKey && (
          <SecondaryButton className="danger" disabled={busy} onClick={() => void changeKey("")}>
            Key entfernen
          </SecondaryButton>
        )}
        <Button disabled={busy || !key.trim()} onClick={() => void changeKey(key)}>
          {busy ? "Prüfe …" : "Testen und speichern"}
        </Button>
      </div>
      {error && <p className="field-error">{error}</p>}

      <Group title="Modell">
        <Row label="Modell" hint={current.hint}>
          <div className="segmented" role="radiogroup" aria-label="Modell">
            {ASSISTANT_MODELS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={m.id === current.id} className={m.id === current.id ? "active" : ""} onClick={() => void chooseModel(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
        </Row>
      </Group>

      <Group title="Hinweise">
        <div className="st-note">
          <p>Der Assistent liest deine Daten. Aufgaben und Termine anlegen, ändern, abhaken oder löschen kann er nur vorschlagen: es passiert erst, wenn du die Karte im Chat bestätigst. Neue Ordner und Seiten für die Dokumentation legt er ebenfalls erst nach deiner Bestätigung an. Auch Änderungen an bestehenden Seiten zeigt er dir vorab mit hervorgehobenem Neuen und Entfallendem und übernimmt sie erst nach deiner Bestätigung. Notizen ändert er nie, und gelöscht wird nichts.</p>
          <p>Für eine Antwort schickt die App die dazu nötigen Auszüge deiner Aufgaben, Termine, Notizen und Seiten an Anthropic. Trading und Strategien bleiben ausgeschlossen.</p>
          <p>Auf einem Firmenrechner nutze den Assistenten nur, wenn die IT es für diese Daten erlaubt.</p>
        </div>
      </Group>
    </>
  );
}

function TradingSection() {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useFlash();

  useEffect(() => {
    getApiKey()
      .then((key) => {
        setApiKey(key);
        setSaved(key);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const dirty = apiKey.trim() !== saved;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveApiKey(apiKey);
      const clean = apiKey.trim();
      setSaved(clean);
      setApiKey(clean);
      setFlash(clean ? "Key geprüft und gespeichert" : "Key entfernt");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Group title="Kursdaten">
        <Row label="Finnhub API-Key" hint="Für aktuelle Aktien- und Krypto-Kurse und die Symbolsuche. Der kostenlose Key von finnhub.io reicht." htmlFor="st-finnhub">
          <input
            id="st-finnhub"
            className="field-control"
            value={apiKey}
            placeholder="Key von finnhub.io einfügen"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setApiKey(e.target.value);
              setFlash(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && dirty && void save()}
          />
        </Row>
        <div className="st-row compact">
          <span className="st-hint">Der Key bleibt in deiner lokalen Datenbank und wird beim Abgleich nicht in den Ordner geschrieben.</span>
        </div>
      </Group>
      <div className="st-actions">
        {flash && (
          <span className="st-flash">
            <Check size={14} /> {flash}
          </span>
        )}
        <Button disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "Prüfe …" : apiKey.trim() ? "Testen und speichern" : "Entfernen"}
        </Button>
      </div>
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

const SHORTCUTS: { keys: string; what: string }[] = [
  { keys: "Strg B", what: "Seitenleiste ein- und ausblenden" },
  { keys: "Strg J", what: "Assistent ein- und ausblenden" },
  { keys: "Strg K", what: "Suche und Befehle öffnen" },
  { keys: "Strg Z / Strg Y", what: "Rückgängig / Wiederholen im Editor" },
  { keys: "Strg I / Strg U", what: "Kursiv / Unterstrichen im Editor" },
  { keys: "Enter", what: "Im Kalender Termin zur Markierung anlegen" },
  { keys: "Esc", what: "Dialog schließen, Ziehen abbrechen" },
];

/** Text unter dem Knopf „Nach Updates suchen“ */
function updateMessage(state: ReturnType<typeof useUpdater>["state"]): string | null {
  switch (state.kind) {
    case "checking":
      return "Suche läuft …";
    case "current":
      return "Du hast die neueste Version.";
    case "available":
      return `Version ${state.version} ist verfügbar.`;
    case "downloading":
      return `Version ${state.version} wird geladen${state.percent !== null ? ` (${state.percent} %)` : " …"}`;
    default:
      return null;
  }
}

function AboutSection() {
  const { state, auto, setAuto, check, install } = useUpdater();
  const [version, setVersion] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    appVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  const busy = state.kind === "checking" || state.kind === "downloading";
  const message = updateMessage(state);

  return (
    <>
      <div className="st-identity">
        <Logo size={52} />
        <div>
          <strong>Wissenszentrum</strong>
          <span>{version ? `Version ${version}` : "Dokumentation, Aufgaben, Kalender, Notizen und Trading"}</span>
        </div>
      </div>
      <Group title="Updates">
        <Row
          label="Suche nach Updates"
          hint={
            auto
              ? "Die App fragt beim Start und danach regelmäßig bei GitHub nach einer neuen Version. Installiert wird erst nach deiner Bestätigung. Übertragen werden keine Daten aus deiner Datenbank."
              : "Die App baut von sich aus keine Verbindung ins Internet auf. Neue Versionen holst du selbst: mit „Nach Updates suchen“ oder über die Download-Seite."
          }
        >
          <div className="segmented" role="radiogroup" aria-label="Suche nach Updates">
            <button type="button" role="radio" aria-checked={auto} className={auto ? "active" : ""} onClick={() => setAuto(true)}>
              Automatisch
            </button>
            <button type="button" role="radio" aria-checked={!auto} className={!auto ? "active" : ""} onClick={() => setAuto(false)}>
              Aus
            </button>
          </div>
        </Row>
        <Row label="Nach Updates suchen" hint="Fragt jetzt einmal nach, auch wenn die automatische Suche aus ist.">
          {state.kind === "available" ? (
            <Button disabled={busy} onClick={() => void install()}>
              Jetzt aktualisieren
            </Button>
          ) : (
            <SecondaryButton disabled={busy} onClick={() => void check(true)}>
              <RefreshCw size={14} /> Suchen
            </SecondaryButton>
          )}
        </Row>
        {message && (
          <div className="st-row compact">
            <span className="st-flash">
              <Check size={14} /> {message}
            </span>
          </div>
        )}
        <Row label="Von Hand herunterladen" hint="Für Rechner ohne Internet: Installer auf einem anderen Rechner laden, per USB-Stick kopieren und starten. Die Daten bleiben erhalten, eine ältere Datenbank wird vor dem Aktualisieren gesichert.">
          <SecondaryButton
            onClick={() => {
              setLogError(null);
              openDownloadPage().catch((e) => setLogError(String(e)));
            }}
          >
            Download-Seite öffnen
          </SecondaryButton>
        </Row>
        <Row label="Protokoll" hint="Hier landen Fehlermeldungen der App. Bei einem Problem hilft diese Datei bei der Suche.">
          <SecondaryButton
            onClick={() => {
              setLogError(null);
              openLogFolder().catch((e) => setLogError(String(e)));
            }}
          >
            Ordner öffnen
          </SecondaryButton>
        </Row>
      </Group>
      {state.kind === "error" && <p className="field-error">{state.message}</p>}
      {logError && <p className="field-error">{logError}</p>}
      <Group title="Kurzbefehle">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="st-row">
            <div className="st-row-text">
              <span className="st-what">{s.what}</span>
            </div>
            <kbd className="st-kbd">{s.keys}</kbd>
          </div>
        ))}
      </Group>
    </>
  );
}

interface SettingsModalProps {
  onClose: () => void;
  /** Bereich, mit dem das Fenster startet */
  initial?: SettingsSection;
}

/** Einstellungen: Seitenleiste mit Bereichen, rechts die Einstellungen als Zeilen in Karten. */
export function SettingsModal({ onClose, initial = "profile" }: SettingsModalProps) {
  const [section, setSection] = useState<SettingsSection>(initial);
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-box" role="dialog" aria-modal="true" aria-label="Einstellungen">
        <nav className="st-nav" aria-label="Einstellungen">
          <h2>Einstellungen</h2>
          <ul>
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button type="button" className={`st-nav-item${id === section ? " active" : ""}`} aria-current={id === section ? "page" : undefined} onClick={() => setSection(id)}>
                  <Icon size={16} />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="st-main">
          <header className="st-head">
            <div>
              <h2>{current.title}</h2>
              <p>{current.lead}</p>
            </div>
            <button type="button" className="icon-btn" aria-label="Schließen" onClick={onClose}>
              <X size={16} />
            </button>
          </header>
          <div className="st-scroll" key={section}>
            {section === "profile" && <ProfileSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "data" && <DataSection />}
            {section === "sync" && <SyncPanel onClose={onClose} />}
            {section === "assistant" && <AssistantSection />}
            {section === "trading" && <TradingSection />}
            {section === "about" && <AboutSection />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
