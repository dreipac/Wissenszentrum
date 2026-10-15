import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FolderOpen, Info, Layers, Lock, MapPin } from "lucide-react";
import { TitleBar } from "../layout/TitleBar";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { completeOnboarding, inspectLocation, pickFolder } from "../../lib/api/app";
import { dbFileIn, type AppState, type LocationInfo } from "../../lib/profile";
import "./Onboarding.css";

type Step = 0 | 1 | 2 | 3;

const STEP_LABELS = ["Profil", "Speicherort", "Fertig"];

const features = [
  { icon: Layers, title: "Alles an einem Ort", text: "Aufgaben, Kalender, Notizen, Trading und Strategien in einer App." },
  { icon: Lock, title: "Lokal und privat", text: "Deine Daten bleiben auf diesem Rechner und werden nirgends hochgeladen." },
  { icon: MapPin, title: "Du bestimmst den Speicherort", text: "Wähle selbst, wo deine Datenbank liegt, und sichere sie, wie du willst." },
];

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
  const firstRef = useRef<HTMLInputElement>(null);
  const namesTouched = useRef(false);

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

  const finish = async (e: FormEvent) => {
    e.preventDefault();
    if (invalidFile || busy) return;
    setBusy(true);
    setError(null);
    try {
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
      <main className="onboarding">
        <div className="ob-card">
          {step > 0 && (
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
            {step === 0 && (
              <>
                <span className="ob-logo" aria-hidden>
                  W
                </span>
                <h1 className="ob-title">Willkommen im Wissenszentrum</h1>
                <p className="ob-lead">Dein persönlicher Arbeitsbereich. Die Einrichtung dauert nur eine Minute.</p>
                <ul className="ob-features">
                  {features.map(({ icon: Icon, title, text }) => (
                    <li key={title}>
                      <span className="ob-feature-icon">
                        <Icon size={16} />
                      </span>
                      <div>
                        <strong>{title}</strong>
                        <span>{text}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                {state.problem && (
                  <div className="ob-notice warn" role="alert">
                    <AlertTriangle size={15} />
                    <span>{state.problem} Wähle den Speicherort unten erneut, um fortzufahren.</span>
                  </div>
                )}
                <div className="ob-actions single">
                  <Button className="ob-primary" autoFocus onClick={() => go(1)}>
                    Einrichtung starten
                    <ArrowRight size={16} />
                  </Button>
                </div>
              </>
            )}

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

            {step === 3 && result && (
              <>
                <span className="ob-logo done" aria-hidden>
                  <Check size={26} strokeWidth={2.5} />
                </span>
                <h1 className="ob-title">Alles bereit, {result.profile?.firstName ?? firstName.trim()}</h1>
                <p className="ob-lead">Dein Wissenszentrum ist eingerichtet. Du kannst jetzt loslegen.</p>
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
      </main>
    </div>
  );
}
