import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Segmented } from "../trading/fields";
import { createEdge, deleteEdge, updateEdge } from "../../lib/api/strategies";
import { EDGE_LABELS, type GraphEdge, type Polarity, type Strategy } from "../../lib/strategies";
import "./StrategyModals.css";

interface EdgeModalProps {
  strategy: Strategy;
  /** Bearbeitet diese Verbindung; sonst wird eine neue von `from` nach `to` angelegt. */
  edge?: GraphEdge;
  from?: number;
  to?: number;
  onClose: () => void;
}

export function EdgeModal({ strategy, edge, from, to, onClose }: EdgeModalProps) {
  const editing = edge !== undefined;
  const fromId = edge?.from ?? from ?? 0;
  const toId = edge?.to ?? to ?? 0;
  const [label, setLabel] = useState(edge?.label ?? "");
  const [polarity, setPolarity] = useState<Polarity>(edge?.polarity ?? "positive");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const titleOf = (id: number) => strategy.nodes.find((n) => n.id === id)?.title ?? "";

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

  const save = () =>
    void run(() => (editing ? updateEdge(edge.id, label, polarity) : createEdge(strategy.id, { from: fromId, to: toId, label, polarity })));

  return (
    <Modal
      title={editing ? "Verbindung bearbeiten" : "Neue Verbindung"}
      width={500}
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
            {editing ? "Speichern" : "Verbinden"}
          </Button>
        </>
      }
    >
      <div className="edge-path">
        <span>{titleOf(fromId)}</span>
        <ArrowRight size={15} />
        <span>{titleOf(toId)}</span>
      </div>

      <div className="field">
        <label htmlFor="edge-label">Beschriftung (optional)</label>
        <input
          id="edge-label"
          className="field-control"
          value={label}
          autoFocus
          maxLength={60}
          placeholder="z. B. führt zu"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
        <div className="edge-suggestions">
          {EDGE_LABELS.map((l) => (
            <button key={l} type="button" className={`edge-chip${label === l ? " active" : ""}`} onClick={() => setLabel(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Wirkung</span>
        <Segmented
          label="Wirkung"
          value={polarity}
          onChange={setPolarity}
          options={[
            { id: "positive", label: "+ verstärkt" },
            { id: "negative", label: "− bremst" },
          ]}
        />
      </div>

      {error && <p className="field-error">{error}</p>}

      {confirmDelete && edge && (
        <ConfirmDialog
          title="Verbindung löschen?"
          message={`Die Verbindung von „${titleOf(edge.from)}“ nach „${titleOf(edge.to)}“ wird gelöscht. Die Knoten bleiben erhalten.`}
          busy={busy}
          onConfirm={() => void run(() => deleteEdge(edge.id))}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
