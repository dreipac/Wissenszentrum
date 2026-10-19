import { createPortal } from "react-dom";
import { Laptop, FolderSync } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { formatNoteTime } from "../../lib/notes";
import { useSync } from "../../lib/useSync";
import "./Sync.css";

interface ConflictModalProps {
  onClose: () => void;
}

/** Beide Seiten haben Änderungen (oder der Ordner enthält beim ersten Abgleich schon einen Stand): Der Mensch entscheidet. */
export function ConflictModal({ onClose }: ConflictModalProps) {
  const { status, busy, error, resolve } = useSync();
  if (!status || status.state !== "conflict") return null;

  const remote = status.remote;
  const first = status.firstTime;

  // Per Portal an den Körper der Seite, damit der Dialog auch über geöffneten Einstellungen liegt
  return createPortal(
    <Modal
      title={first ? "Der Ordner enthält schon einen Stand" : "Änderungen auf beiden Rechnern"}
      width={600}
      onClose={onClose}
      footer={
        <>
          <SecondaryButton disabled={busy} onClick={onClose}>
            Später entscheiden
          </SecondaryButton>
          <span className="spacer" />
          <SecondaryButton disabled={busy} onClick={() => void resolve("local")}>
            Diesen Rechner behalten
          </SecondaryButton>
          <Button disabled={busy} onClick={() => void resolve("remote")}>
            Stand aus dem Ordner laden
          </Button>
        </>
      }
    >
      <p className="sync-lead">
        {first
          ? "Auf diesem Rechner und im Abgleich-Ordner liegen unterschiedliche Daten. Wähle, welche Daten gelten sollen."
          : "Seit dem letzten Abgleich wurde auf diesem Rechner und im Ordner etwas geändert. Wähle, welcher Stand gelten soll."}
      </p>

      <div className="sync-compare">
        <div className="sync-side">
          <span className="sync-side-icon">
            <Laptop size={16} />
          </span>
          <strong>Dieser Rechner</strong>
          <span>{status.deviceName}</span>
          <span className="muted">{status.lastSyncedAt ? `Zuletzt abgeglichen ${formatNoteTime(status.lastSyncedAt)}` : "Noch nie abgeglichen"}</span>
        </div>
        <div className="sync-side">
          <span className="sync-side-icon">
            <FolderSync size={16} />
          </span>
          <strong>Abgleich-Ordner</strong>
          <span>{remote ? `Stand von ${remote.thisDevice ? "diesem Rechner" : remote.deviceName}` : "Stand unbekannt"}</span>
          <span className="muted">{remote ? `Gespeichert ${formatNoteTime(remote.savedAt)}` : ""}</span>
        </div>
      </div>

      <p className="field-hint sync-note">
        Der Stand, der nicht gewinnt, wird vorher als Sicherung im lokalen Datenordner abgelegt und lässt sich später über „Bestehende Datenbank öffnen“ wiederherstellen.
      </p>

      {error && <p className="field-error">{error}</p>}
    </Modal>,
    document.body,
  );
}
