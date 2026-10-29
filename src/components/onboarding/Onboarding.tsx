import { Logo } from "../ui/Logo";
import preview1600 from "../../assets/onboarding-preview-1600.webp";
import preview2200 from "../../assets/onboarding-preview-2200.webp";
import preview2800 from "../../assets/onboarding-preview-2800.webp";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Database, FolderOpen, Info, X } from "lucide-react";
import { TitleBar } from "../layout/TitleBar";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { completeOnboarding, inspectDatabase, inspectLocation, openExistingDatabase, pickDatabaseFile, pickFolder } from "../../lib/api/app";
import { dbFileIn, type AppState, type LocationInfo } from "../../lib/profile";
import { readAutoUpdate, writeAutoUpdate } from "../../lib/useUpdater";
import "./Onboarding.css";

/** 0 Willkommen, 1 Name, 2 Speicherort, 3 Fertig, 4 vorhandene Datenbank öffnen */
type Step = 0 | 1 | 2 | 3 | 4;

const STEP_LABELS = ["Profil", "Speicherort", "Fertig"];


interface OnboardingProps {
  state: AppState;
  onDone: (state: AppState) => void;
}

/** Einrichtung beim ersten Start: Willkommen, Name, Speicherort der Datenbank, Abschluss. */
export function Onboarding({ state, onDone }: OnboardingProps) {
  const [step, setStep] = useState<Step>(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [firstName, setFirstName] = useState(state.profile?.firstName ?? "");
  const [lastName, setLastName] = useState(state.profile?.lastName ?? "");
  const [dir, setDir] = useState(state.defaultDir);
  const [info, setInfo] = useState<LocationInfo | null>(null);
  const [result, setResult] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [triedNames, setTriedNames] = useState(false);
  // Hinweis „Datenbank nicht gefunden“ auf der Willkommensseite wegklicken
  const [problemClosed, setProblemClosed] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const namesTouched = useRef(false);

  // Vorhandene Datenbank öffnen
  const [mode, setMode] = useState<"new" | "open">("new");
  const [file, setFile] = useState("");
  const [fileInfo, setFileInfo] = useState<LocationInfo | null>(null);
  const [openFirst, setOpenFirst] = useState("");
  const [openLast, setOpenLast] = useState("");
  const [triedOpen, setTriedOpen] = useState(false);

  // Suche nach Updates: wird sofort gemerkt, die Einstellungen zeigen dieselbe Wahl
  const [autoUpdate, setAutoUpdate] = useState(readAutoUpdate);
  const chooseAutoUpdate = (on: boolean) => {
    setAutoUpdate(on);
    writeAutoUpdate(on);
  };

  const go = (next: Step) => {
    setDirection(next > step ? "forward" : "back");
    setError(null);
    setStep(next);
  };

  // Hinweis zum gewählten Ort: liegt dort schon eine Datenbank?
  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    inspectLocation(dir)
      .then((i) => {
        if (cancelled) return;
        setInfo(i);
        // Gehört die vorhandene Datenbank schon jemandem, den Namen vorschlagen, solange noch nichts eingetippt wurde
        if (i.profile && !namesTouched.current) {
          setFirstName(i.profile.firstName);
          setLastName(i.profile.lastName);
        }
      })
      .catch(() => !cancelled && setInfo(null));
    return () => {
      cancelled = true;
    };
  }, [dir]);

  useEffect(() => {
    if (step === 1) firstRef.current?.focus();
  }, [step]);

  // Gewählte Datei prüfen: gültig, älter, neuer, wessen Name?
  useEffect(() => {
    if (!file) return setFileInfo(null);
    let cancelled = false;
    inspectDatabase(file)
      .then((i) => !cancelled && setFileInfo(i))
      .catch(() => !cancelled && setFileInfo(null));
    return () => {
      cancelled = true;
    };
  }, [file]);

  const nameOk = firstName.trim() !== "" && lastName.trim() !== "";
  const invalidFile = info?.exists === true && !info.valid;

  const submitNames = (e: FormEvent) => {
    e.preventDefault();
    setTriedNames(true);
    if (nameOk) go(2);
  };

  const change = async () => {
    try {
      const picked = await pickFolder(dir);
      if (picked) setDir(picked);
    } catch (e) {
      setError(String(e));
    }
  };

  const startOpen = () => {
    setMode("open");
    go(4);
  };

  const pickFile = async () => {
    try {
      const picked = await pickDatabaseFile(file || state.defaultDir);
      if (picked) {
        setFile(picked);
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const openNeedsName = fileInfo?.valid === true && fileInfo.profile === null;
  const openNamesOk = openFirst.trim() !== "" && openLast.trim() !== "";
  const canOpen = fileInfo?.valid === true && (!openNeedsName || openNamesOk);

  const openExisting = async (e: FormEvent) => {
    e.preventDefault();
    setTriedOpen(true);
    if (!canOpen || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await openExistingDatabase({ path: file, firstName: openNeedsName ? openFirst : "", lastName: openNeedsName ? openLast : "" }));
      setDirection("forward");
      setStep(3);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (e: FormEvent) => {
    e.preventDefault();
    if (invalidFile || busy) return;
    setBusy(true);
    setError(null);
    try {
      setMode("new");
      setResult(await completeOnboarding({ firstName, lastName, dir }));
      setDirection("forward");
      setStep(3);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell">
      <TitleBar minimal />
      <main className={`onboarding${step > 0 ? " flow" : ""}`}>
        {step === 0 && (
          <section className="ob-hero" aria-label="Willkommen">
            <div className="ob-hero-mark">
              <span className="ob-hero-glow" aria-hidden="true" />
              <Logo size={132} className="ob-hero-logo" />
            </div>
            <h1 className="ob-hero-title">
              <span>Willkommen im</span>
              Wissenszentrum
            </h1>
            <p className="ob-hero-lead">Dein zentraler Ort für Wissen, Aufgaben, Termine, Notizen, Trading und mehr.</p>

            {state.problem && !problemClosed && (
              <div className="ob-notice warn ob-hero-notice" role="alert">
                <AlertTriangle size={15} />
                <span>{state.problem} Richte den Speicherort neu ein oder öffne die Datenbank erneut.</span>
                <button type="button" className="ob-notice-close" aria-label="Hinweis schließen" title="Schließen" onClick={() => setProblemClosed(true)}>
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="ob-hero-actions">
              <Button
                autoFocus
                onClick={() => {
                  setMode("new");
                  go(1);
                }}
              >
                Einrichtung starten
                <ArrowRight size={16} />
              </Button>
              <SecondaryButton onClick={startOpen}>
                <Database size={16} />
                Bestehende Datenbank öffnen
              </SecondaryButton>
            </div>
          </section>
        )}

        {step > 0 && (
        <div className="ob-flow">
          <Logo size={44} className="ob-flow-logo" />
          {step > 0 && step < 4 && !(step === 3 && mode === "open") && (
            <ol className="ob-progress" aria-label="Fortschritt">
              {STEP_LABELS.map((label, i) => (
                <li key={label} className={step === 3 || i + 1 < step ? "done" : i + 1 === step ? "current" : ""} aria-current={i + 1 === step && step < 3 ? "step" : undefined}>
                  <span className="ob-dot">{step === 3 || i + 1 < step ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
                  <span className="ob-progress-label">{label}</span>
                </li>
              ))}
            </ol>
          )}

          <div key={step} className={`ob-step ${direction}`}>
            {step === 1 && (
              <form onSubmit={submitNames} noValidate>
                <h1 className="ob-title">Wie heißt du?</h1>
                <p className="ob-lead">Dein Name erscheint in der Seitenleiste und in der Begrüßung auf dem Dashboard.</p>
                <div className="ob-fields">
                  <div className="field">
                    <label htmlFor="ob-first">Vorname</label>
                    <input
                      id="ob-first"
                      ref={firstRef}
                      className={`field-control${triedNames && !firstName.trim() ? " invalid" : ""}`}
                      value={firstName}
                      maxLength={60}
                      autoComplete="given-name"
                      placeholder="Vorname"
                      onChange={(e) => {
                        namesTouched.current = true;
                        setFirstName(e.target.value);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ob-last">Nachname</label>
                    <input
                      id="ob-last"
                      className={`field-control${triedNames && !lastName.trim() ? " invalid" : ""}`}
                      value={lastName}
                      maxLength={60}
                      autoComplete="family-name"
                      placeholder="Nachname"
                      onChange={(e) => {
                        namesTouched.current = true;
                        setLastName(e.target.value);
                      }}
                    />
                  </div>
                </div>
                {triedNames && !nameOk && <p className="field-error">Bitte gib Vor- und Nachnamen ein.</p>}
                <div className="ob-actions">
                  <SecondaryButton onClick={() => go(0)}>
                    <ArrowLeft size={16} />
                    Zurück
                  </SecondaryButton>
                  <Button type="submit" className="ob-primary">
                    Weiter
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </form>
            )}

            {step === 2 && (
              <form onSubmit={(e) => void finish(e)}>
                <h1 className="ob-title">Wo sollen deine Daten liegen?</h1>
                <p className="ob-lead">Alles wird in einer einzigen Datei auf deinem Rechner gespeichert. Du kannst den Ordner frei wählen.</p>

                <div className="ob-location">
                  <span className="ob-label">Speicherort</span>
                  <div className="ob-path-row">
                    <div className="ob-path" title={dir}>
                      <FolderOpen size={16} />
                      <span>{dir}</span>
                    </div>
                    <SecondaryButton onClick={() => void change()}>Ändern …</SecondaryButton>
                  </div>
                  <span className="ob-file">
                    Datei: <code>{dbFileIn(dir)}</code>
                  </span>
                </div>

                {invalidFile ? (
                  <div className="ob-notice error" role="alert">
                    <AlertTriangle size={15} />
                    <span>Dort liegt eine Datei „wissenszentrum.db“, die keine gültige Datenbank ist. Wähle einen anderen Ordner.</span>
                  </div>
                ) : info?.exists ? (
                  <div className="ob-notice info">
                    <Info size={15} />
                    <span>
                      Hier liegt bereits eine Datenbank
                      {info.profile ? ` von ${info.profile.firstName} ${info.profile.lastName}` : ""}. Ihre Daten werden übernommen.
                    </span>
                  </div>
                ) : (
                  <div className="ob-notice info">
                    <Info size={15} />
                    <span>Es wird eine neue, leere Datenbank angelegt. Liegt der Ordner in einem Backup- oder Cloud-Ordner (z. B. OneDrive), ist sie automatisch gesichert.</span>
                  </div>
                )}

                {error && <p className="field-error">{error}</p>}
                <div className="ob-actions">
                  <SecondaryButton disabled={busy} onClick={() => go(1)}>
                    <ArrowLeft size={16} />
                    Zurück
                  </SecondaryButton>
                  <Button type="submit" className="ob-primary" disabled={busy || invalidFile}>
                    {busy ? "Wird eingerichtet …" : "Einrichten"}
                  </Button>
                </div>
              </form>
            )}

            {step === 4 && (
              <form onSubmit={(e) => void openExisting(e)} noValidate>
                <h1 className="ob-title">Bestehende Datenbank öffnen</h1>
                <p className="ob-lead">Wähle die Datei deiner Datenbank, zum Beispiel aus einem Backup oder von einem anderen Rechner.</p>

                <div className="ob-location">
                  <span className="ob-label">Datenbankdatei</span>
                  <div className="ob-path-row">
                    <div className={`ob-path${file ? "" : " empty"}`} title={file}>
                      <Database size={16} />
                      <span>{file || "Keine Datei gewählt"}</span>
                    </div>
                    <SecondaryButton onClick={() => void pickFile()}>{file ? "Ändern …" : "Datei wählen …"}</SecondaryButton>
                  </div>
                </div>

                {fileInfo?.newer ? (
                  <div className="ob-notice error" role="alert">
                    <AlertTriangle size={15} />
                    <span>Diese Datenbank stammt aus einer neueren Version des Wissenszentrums. Bitte aktualisiere zuerst die App.</span>
                  </div>
                ) : fileInfo && !fileInfo.exists ? (
                  <div className="ob-notice error" role="alert">
                    <AlertTriangle size={15} />
                    <span>Die Datei wurde nicht gefunden.</span>
                  </div>
                ) : fileInfo && !fileInfo.valid ? (
                  <div className="ob-notice error" role="alert">
                    <AlertTriangle size={15} />
                    <span>Das ist keine Datenbank des Wissenszentrums.</span>
                  </div>
                ) : fileInfo ? (
                  <div className="ob-notice info">
                    <Info size={15} />
                    <span>
                      Datenbank{fileInfo.profile ? ` von ${fileInfo.profile.firstName} ${fileInfo.profile.lastName}` : ""} gefunden. Ihre Daten werden übernommen.
                      {fileInfo.needsUpdate && " Sie stammt aus einer älteren Version und wird aktualisiert. Davor legt das Programm eine Sicherung neben der Datei an."}
                    </span>
                  </div>
                ) : null}

                {openNeedsName && (
                  <>
                    <p className="ob-lead ob-after">In dieser Datenbank ist noch kein Name hinterlegt. Wie heißt du?</p>
                    <div className="ob-fields">
                      <div className="field">
                        <label htmlFor="ob-open-first">Vorname</label>
                        <input
                          id="ob-open-first"
                          className={`field-control${triedOpen && !openFirst.trim() ? " invalid" : ""}`}
                          value={openFirst}
                          maxLength={60}
                          placeholder="Vorname"
                          onChange={(e) => setOpenFirst(e.target.value)}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="ob-open-last">Nachname</label>
                        <input
                          id="ob-open-last"
                          className={`field-control${triedOpen && !openLast.trim() ? " invalid" : ""}`}
                          value={openLast}
                          maxLength={60}
                          placeholder="Nachname"
                          onChange={(e) => setOpenLast(e.target.value)}
                        />
                      </div>
                    </div>
                    {triedOpen && !openNamesOk && <p className="field-error">Bitte gib Vor- und Nachnamen ein.</p>}
                  </>
                )}

                {error && <p className="field-error">{error}</p>}
                <div className="ob-actions">
                  <SecondaryButton
                    disabled={busy}
                    onClick={() => {
                      setMode("new");
                      go(0);
                    }}
                  >
                    <ArrowLeft size={16} />
                    Zurück
                  </SecondaryButton>
                  <Button type="submit" className="ob-primary" disabled={busy || !canOpen}>
                    {busy ? "Wird geöffnet …" : "Datenbank öffnen"}
                  </Button>
                </div>
              </form>
            )}

            {step === 3 && result && (
              <>
                <span className="ob-logo done" aria-hidden>
                  <Check size={26} strokeWidth={2.5} />
                </span>
                <h1 className="ob-title">
                  {mode === "open" ? "Willkommen zurück" : "Alles bereit"}, {result.profile?.firstName ?? firstName.trim()}
                </h1>
                <p className="ob-lead">{mode === "open" ? "Deine Datenbank ist geöffnet. Alle deine Daten sind da." : "Dein Wissenszentrum ist eingerichtet. Du kannst jetzt loslegen."}</p>
                <dl className="ob-summary">
                  <div>
                    <dt>Name</dt>
                    <dd>{result.profile ? `${result.profile.firstName} ${result.profile.lastName}` : ""}</dd>
                  </div>
                  <div>
                    <dt>Datenbank</dt>
                    <dd title={result.dbPath ?? ""}>{result.dbPath}</dd>
                  </div>
                </dl>
                <div className="ob-choice">
                  <div className="ob-choice-head">
                    <span className="ob-choice-title" id="ob-update-label">
                      Updates
                    </span>
                    <div className="segmented" role="radiogroup" aria-labelledby="ob-update-label">
                      <button type="button" role="radio" aria-checked={autoUpdate} className={autoUpdate ? "active" : ""} onClick={() => chooseAutoUpdate(true)}>
                        Automatisch
                      </button>
                      <button type="button" role="radio" aria-checked={!autoUpdate} className={!autoUpdate ? "active" : ""} onClick={() => chooseAutoUpdate(false)}>
                        Aus
                      </button>
                    </div>
                  </div>
                  <p>
                    {autoUpdate
                      ? "Die App fragt beim Start und danach regelmäßig bei GitHub nach einer neuen Version. Installiert wird erst nach deiner Bestätigung, und aus deiner Datenbank wird nichts übertragen."
                      : "Die App baut von sich aus keine Verbindung ins Internet auf. Neue Versionen holst du selbst."}{" "}
                    Du kannst das jederzeit unter Einstellungen → Info ändern.
                  </p>
                </div>
                <div className="ob-actions single">
                  <Button className="ob-primary" autoFocus onClick={() => onDone(result)}>
                    Wissenszentrum öffnen
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
        )}

        {step > 0 && (
          <div className="ob-peek" aria-hidden="true">
            <span className="ob-peek-glow" />
            <img
              src={preview2200}
              srcSet={`${preview1600} 1600w, ${preview2200} 2200w, ${preview2800} 2800w`}
              sizes="max(1250px, 112vw)"
              alt=""
              className="ob-peek-img"
              draggable={false}
            />
          </div>
        )}
      </main>
    </div>
  );
}
