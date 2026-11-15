import { useState } from "react";
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
 * Projekt anlegen oder bearbeiten: Name, der Ordner oder die Seite der Dokumentation, die als Kontext gilt, und Hinweise
 * für den Assistenten. Die Felder heißen wie in der Projektübersicht.
 */
export function ProjectModal({ project, onClose, onSaved, onDeleted }: ProjectModalProps) {
  const editing = project !== undefined;
  const [name, setName] = useState(project?.name ?? "");
  const [docId, setDocId] = useState<number | null>(project?.docId ?? null);
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    if (!name.trim()) return setError("Gib dem Projekt einen Namen.");
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
      width={560}
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
            {editing ? "Speichern" : "Erstellen"}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="pm-name">Name</label>
        <input
          id="pm-name"
          className="field-control"
          value={name}
          autoFocus
          placeholder="z. B. Studienplanung"
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
      </div>

      <div className="field">
        <span className="field-label">Dokumentation</span>
        <DocPicker value={docId} onChange={setDocId} />
      </div>

      <div className="field">
        <label htmlFor="pm-notes">Hinweise</label>
        <textarea
          id="pm-notes"
          className="field-control pm-text"
          value={instructions}
          rows={3}
          maxLength={2000}
          placeholder="z. B. Schreib in der Du-Form und halte Seiten kurz."
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>

      {error && <p className="field-error">{error}</p>}

      {confirmDelete && editing && (
        <ConfirmDialog
          title="Projekt löschen?"
          message={`„${project.name}“ wird gelöscht. Chats und Dokumentation bleiben erhalten.`}
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
