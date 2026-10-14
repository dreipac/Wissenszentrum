import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { createStrategy, deleteStrategy, renameStrategy } from "../../lib/api/strategies";
import type { Strategy } from "../../lib/strategies";

interface StrategyModalProps {
  /** Ohne Angabe wird eine neue Strategie angelegt, sonst diese umbenannt. */
  strategy?: Strategy;
  /** Wird nach dem Anlegen mit der neuen ID aufgerufen. */
  onCreated?: (id: number) => void;
  onClose: () => void;
}

export function StrategyModal({ strategy, onCreated, onClose }: StrategyModalProps) {
  const editing = strategy !== undefined;
  const [title, setTitle] = useState(strategy?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const save = () => {
    if (!title.trim()) return setError("Bitte gib einen Namen ein.");
    void run(async () => {
      if (editing) return renameStrategy(strategy.id, title);
      onCreated?.(await createStrategy(title));
    });
  };

  return (
    <Modal
      title={editing ? "Strategie bearbeiten" : "Neue Strategie"}
      width={480}
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
          <Button disabled={busy} onClick={save}>
            {editing ? "Speichern" : "Strategie erstellen"}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="strategy-title">Name</label>
        <input
          id="strategy-title"
          className="field-control"
          value={title}
          autoFocus
          maxLength={120}
          placeholder="z. B. BlackRock & ETF-Zuflüsse"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </div>

      {error && <p className="field-error">{error}</p>}

      {confirmDelete && strategy && (
        <ConfirmDialog
          title="Strategie löschen?"
          message={
            strategy.nodes.length === 0
              ? `„${strategy.title}“ ist leer und wird entfernt.`
              : `„${strategy.title}“ wird samt ${strategy.nodes.length} Knoten und ${strategy.edges.length} ${strategy.edges.length === 1 ? "Verbindung" : "Verbindungen"} dauerhaft gelöscht. Positionen und Orders im Trading bleiben unberührt.`
          }
          busy={busy}
          onConfirm={() => void run(() => deleteStrategy(strategy.id))}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
