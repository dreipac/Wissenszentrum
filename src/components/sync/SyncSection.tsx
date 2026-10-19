import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { SecondaryButton } from "../ui/SecondaryButton";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { pickFolder } from "../../lib/api/app";
import { formatNoteTime } from "../../lib/notes";
import { stateLabel, stateTone } from "../../lib/sync";
import { useSync } from "../../lib/useSync";
import "./Sync.css";

interface SyncSectionProps {
  /** Öffnet den Dialog zum Lösen eines Konflikts */
  onResolve: () => void;
  /** Ohne eigene Überschrift und Trennlinie (wenn die Umgebung schon eine Überschrift hat) */
  bare?: boolean;
}

/** Einstellungen für den Abgleich zwischen Rechnern. */
export function SyncSection({ onResolve, bare = false }: SyncSectionProps) {
  const { status, busy, error, enable, now, disable } = useSync();
  const [dir, setDir] = useState("");
  const [device, setDevice] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Vorschläge übernehmen, sobald der Zustand da ist
  useEffect(() => {
    if (!status) return;
    setDir((d) => d || status.suggestedDir || "");
    setDevice((d) => d || status.defaultDeviceName);
  }, [status]);

  if (!status) return null;

  const change = async () => {
    setLocalError(null);
    try {
      const picked = await pickFolder(dir || status.suggestedDir || "");
      if (picked) setDir(picked);
    } catch (e) {
      setLocalError(String(e));
    }
  };

  return (
    <section className={`sync-section${bare ? " bare" : ""}`} aria-labelledby={bare ? undefined : "sync-title"} aria-label={bare ? "Abgleich zwischen Rechnern" : undefined}>
      {!bare && (
        <h3 id="sync-title" className="sync-title">
          Abgleich zwischen Rechnern
        </h3>
      )}

      {!status.enabled ? (
        <>
          <p className="sync-lead">
            Arbeite abwechselnd an mehreren Rechnern, zum Beispiel zuhause und in der Schule. Beim Schließen legt die App einen Stand in einem Ordner ab (z. B. OneDrive),
            beim Starten auf dem anderen Rechner lädt sie ihn. Arbeite immer nur an einem Rechner gleichzeitig.
          </p>
          <div className="field">
            <label htmlFor="sync-dir">Abgleich-Ordner</label>
            <div className="sync-path-row">
              <div className="sync-path" title={dir}>
                <FolderOpen size={15} />
                <span className={dir ? "" : "empty"}>{dir || "Noch kein Ordner gewählt"}</span>
              </div>
              <SecondaryButton onClick={() => void change()}>Ändern …</SecondaryButton>
            </div>
          </div>
          <div className="field">
            <label htmlFor="sync-device">Name dieses Rechners</label>
            <input id="sync-device" className="field-control" value={device} maxLength={60} placeholder="z. B. PC Zuhause" onChange={(e) => setDevice(e.target.value)} />
            <span className="field-hint">Erscheint beim anderen Rechner, etwa „Stand von Schul-Laptop“.</span>
          </div>
          <p className="field-hint sync-note">
            Der Stand liegt im Ordner unverschlüsselt. Dein Finnhub-API-Key bleibt dabei auf dem jeweiligen Rechner und wird nicht in den Ordner geschrieben.
          </p>
          <Button className="sm" disabled={busy || !dir.trim()} onClick={() => void enable(dir, device)}>
            {busy ? "Wird eingerichtet …" : "Abgleich einschalten"}
          </Button>
        </>
      ) : (
        <>
          <div className={`sync-state ${stateTone(status.state)}`}>
            <span className="sync-dot" aria-hidden />
            <strong>{stateLabel[status.state]}</strong>
            {status.state === "pull" && status.remote && <span>von {status.remote.deviceName}</span>}
          </div>
          {status.message && <p className="field-error sync-message">{status.message}</p>}
          {status.state === "waiting" && <p className="field-hint">OneDrive hat den Stand noch nicht fertig synchronisiert. Das dauert meist nur kurz.</p>}

          <dl className="sync-facts">
            <div>
              <dt>Ordner</dt>
              <dd title={status.syncDir ?? ""}>{status.syncDir}</dd>
            </div>
            <div>
              <dt>Dieser Rechner</dt>
              <dd>{status.deviceName}</dd>
            </div>
            <div>
              <dt>Letzter Abgleich</dt>
              <dd>{status.lastSyncedAt ? formatNoteTime(status.lastSyncedAt) : "noch nie"}</dd>
            </div>
          </dl>

          <div className="sync-actions">
            {status.state === "conflict" && (
              <Button className="sm" onClick={onResolve}>
                Konflikt lösen …
              </Button>
            )}
            <SecondaryButton className="sm" disabled={busy || status.state === "conflict"} onClick={() => void now()}>
              <RefreshCw size={14} className={busy ? "spin" : ""} />
              Jetzt abgleichen
            </SecondaryButton>
            <SecondaryButton className="sm danger" disabled={busy} onClick={() => setConfirmOff(true)}>
              Abgleich beenden
            </SecondaryButton>
          </div>
        </>
      )}

      {(error || localError) && <p className="field-error">{error ?? localError}</p>}

      {confirmOff && (
        <ConfirmDialog
          title="Abgleich beenden?"
          message="Dieser Rechner gleicht danach nicht mehr mit dem Ordner ab. Deine Daten hier und die Dateien im Ordner bleiben unverändert."
          confirmLabel="Beenden"
          busy={busy}
          onConfirm={() => {
            setConfirmOff(false);
            void disable();
          }}
          onCancel={() => setConfirmOff(false)}
        />
      )}
    </section>
  );
}
