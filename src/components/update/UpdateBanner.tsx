import { Download, X } from "lucide-react";
import { useUpdater } from "../../lib/useUpdater";
import "../sync/Sync.css";
import "./Update.css";

/** Hinweis unten in der Mitte, sobald eine neue Version bereitsteht. Installiert wird erst nach Klick. */
export function UpdateBanner() {
  const { state, dismissed, dismiss, install } = useUpdater();

  const available = state.kind === "available" && !dismissed;
  const downloading = state.kind === "downloading";
  if (!available && !downloading) return null;

  return (
    <div className="update-banners" aria-live="polite">
      <div className="sync-banner info" role="status">
        <Download size={15} />
        {state.kind === "available" && (
          <>
            <span>
              Version <strong>{state.version}</strong> ist verfügbar.
            </span>
            <button type="button" className="sync-banner-btn" onClick={() => void install()}>
              Jetzt aktualisieren
            </button>
            <button type="button" className="icon-btn" aria-label="Später erinnern" title="Später" onClick={dismiss}>
              <X size={14} />
            </button>
          </>
        )}
        {state.kind === "downloading" && (
          <span>
            Version <strong>{state.version}</strong> wird geladen{state.percent !== null ? ` (${state.percent} %)` : " …"} Die App startet danach neu.
          </span>
        )}
      </div>
    </div>
  );
}
