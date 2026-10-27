import { useState } from "react";
import { Plus } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { createProject, deleteProject, updateProject } from "../../lib/api/projects";
import type { Project } from "../../lib/projects";
import { DocPicker } from "./DocPicker";
import "./Projects.css";

interface ProjectModalProps {
  /** Ohne Angabe wird ein neues Projekt angelegt, sonst dieses bearbeitet. */
  project?: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
  onDeleted: (id: number) => void;
}

/**
 * Projekt anlegen oder bearbeiten: ein Name und der Ordner oder die Seite der Dokumentation, die als Kontext gilt.
 * Mit einem aktiven Projekt weiß der Assistent, wo Neues hingehört und was „die Doku“ ist.
 */
export function ProjectModal({ project, onClose, onSaved, onDeleted }: ProjectModalProps) {
  const editing = project !== undefined;
  const [name, setName] = useState(project?.name ?? "");
  const [docId, setDocId] = useState<number | null>(project?.docId ?? null);
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const [showHints, setShowHints] = useState(Boolean(project?.instructions));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    if (!name.trim()) return setError("Bitte gib dem Projekt einen Namen.");
    setBusy(true);
    setError(null);
    try {
      const input = { name, docId, instructions };
      onSaved(editing ? await updateProject(project.id, input) : await createProject(input));
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await deleteProject(project.id);
      onDeleted(project.id);
      onClose();
    } catch (e) {
      setConfirmDelete(false);
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? "Projekt bearbeiten" : "Neues Projekt"}
      width={520}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <SecondaryButton className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Löschen
            </SecondaryButton>
          )}
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <Button disabled={busy} onClick={() => void save()}>
            {editing ? "Speichern" : "Projekt erstellen"}
          </Button>
        </>
      }
    >
      <label className="pm-field">
        <span className="pm-label">Name</span>
        <input
          className="field-control"
          value={name}
          autoFocus
          placeholder="z. B. Studienplanung"
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
      </label>

      <div className="pm-field">
        <span className="pm-label">Dokumentation als Kontext</span>
        <p className="pm-hint">Wähle den Ordner oder die Seite, um die es in diesem Projekt geht. Der Assistent legt dort Neues an und sucht zuerst dort.</p>
        <DocPicker value={docId} onChange={setDocId} />
      </div>

      {showHints ? (
        <label className="pm-field">
          <span className="pm-label">Hinweise für den Assistenten</span>
          <textarea
            className="field-control pm-text"
            value={instructions}
            maxLength={2000}
            placeholder="z. B. Schreib immer in der Du-Form und halte Seiten kurz."
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
      ) : (
        <button type="button" className="pm-link" onClick={() => setShowHints(true)}>
          <Plus size={14} />
          Hinweise für den Assistenten
        </button>
      )}

      {error && <p className="field-error">{error}</p>}

      {confirmDelete && editing && (
        <ConfirmDialog
          title="Projekt löschen?"
          message={`„${project.name}“ wird gelöscht. Die Dokumentation bleibt unverändert.`}
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
