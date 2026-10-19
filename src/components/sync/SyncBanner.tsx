import { useEffect, useState } from "react";
import { AlertTriangle, Check, RefreshCw, X } from "lucide-react";
import { formatNoteTime } from "../../lib/notes";
import { useSync } from "../../lib/useSync";
import { ConflictModal } from "./ConflictModal";
import "./Sync.css";

/** Ereignis, mit dem andere Stellen den Konflikt-Dialog öffnen lassen */
export const OPEN_CONFLICT_EVENT = "wz-open-sync-conflict";

/** Meldungen zum Abgleich über dem Inhalt und der Konflikt-Dialog, der sich bei einem Konflikt von selbst öffnet. */
export function SyncBanner() {
  const { status, busy, notice, dismissNotice, now } = useSync();
  const [conflictOpen, setConflictOpen] = useState(false);
  const [errorHidden, setErrorHidden] = useState<string | null>(null);

  const state = status?.state;

  // Bei einem neu entdeckten Konflikt den Dialog öffnen
  useEffect(() => {
    if (state === "conflict") setConflictOpen(true);
    else setConflictOpen(false);
  }, [state]);

  // Die Einstellungen können den Dialog ebenfalls anfordern
  useEffect(() => {
    const open = () => setConflictOpen(true);
    window.addEventListener(OPEN_CONFLICT_EVENT, open);
    return () => window.removeEventListener(OPEN_CONFLICT_EVENT, open);
  }, []);

  // Hinweis zum beim Start geladenen Stand nach kurzer Zeit ausblenden
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismissNotice, 9000);
    return () => window.clearTimeout(timer);
  }, [notice, dismissNotice]);

  const error = state === "error" && status?.message && status.message !== errorHidden ? status.message : null;

  return (
    <>
      <div className="sync-banners" aria-live="polite">
        {notice && (
          <div className="sync-banner ok" role="status">
            <Check size={15} />
            <span>
              Stand von <strong>{notice.deviceName}</strong> ({formatNoteTime(notice.savedAt)}) geladen.
            </span>
            <button type="button" className="icon-btn" aria-label="Hinweis schließen" onClick={dismissNotice}>
              <X size={14} />
            </button>
          </div>
        )}

        {state === "pull" && status?.remote && (
          <div className="sync-banner info" role="status">
            <RefreshCw size={15} />
            <span>
              Neuer Stand von <strong>{status.remote.deviceName}</strong> ({formatNoteTime(status.remote.savedAt)}) verfügbar.
            </span>
            <button type="button" className="sync-banner-btn" disabled={busy} onClick={() => void now()}>
              Jetzt laden
            </button>
          </div>
        )}

        {state === "conflict" && !conflictOpen && (
          <div className="sync-banner warn" role="alert">
            <AlertTriangle size={15} />
            <span>Abgleich: Änderungen auf beiden Rechnern.</span>
            <button type="button" className="sync-banner-btn" onClick={() => setConflictOpen(true)}>
              Entscheiden
            </button>
          </div>
        )}

        {error && (
          <div className="sync-banner warn" role="alert">
            <AlertTriangle size={15} />
            <span>{error}</span>
            <button type="button" className="icon-btn" aria-label="Meldung schließen" onClick={() => setErrorHidden(error)}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {conflictOpen && <ConflictModal onClose={() => setConflictOpen(false)} />}
    </>
  );
}
