import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { createNode, deleteNode, updateNode } from "../../lib/api/strategies";
import { NODE_KINDS, nodeKindLabel, type GraphNode, type NodeKind, type Point, type Strategy } from "../../lib/strategies";
import { kindIcon } from "./kinds";
import "./StrategyModals.css";

interface NodeModalProps {
  strategy: Strategy;
  /** Ohne Angabe wird ein neuer Knoten bei `position` angelegt, sonst dieser bearbeitet. */
  node?: GraphNode;
  position?: Point;
  /** Symbole aus dem Trading als Vorschläge */
  symbols: string[];
  /** Wird nach dem Anlegen mit der neuen ID aufgerufen. */
  onCreated?: (id: number) => void;
  onClose: () => void;
}

export function NodeModal({ strategy, node, position, symbols, onCreated, onClose }: NodeModalProps) {
  const editing = node !== undefined;
  const [title, setTitle] = useState(node?.title ?? "");
  const [kind, setKind] = useState<NodeKind>(node?.kind ?? "event");
  const [symbol, setSymbol] = useState(node?.symbol ?? "");
  const [text, setText] = useState(node?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const edgeCount = node ? strategy.edges.filter((e) => e.from === node.id || e.to === node.id).length : 0;

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
    if (!title.trim()) return setError("Bitte gib einen Titel ein.");
    const input = { title, kind, text, symbol, x: node?.x ?? position?.x ?? 0, y: node?.y ?? position?.y ?? 0 };
    void run(async () => {
      if (editing) return updateNode(node.id, input);
      const created = await createNode(strategy.id, input);
      onCreated?.(created.id);
    });
  };

  return (
    <Modal
      title={editing ? "Knoten bearbeiten" : "Neuer Knoten"}
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
          <Button disabled={busy} onClick={save}>
            {editing ? "Speichern" : "Knoten erstellen"}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="node-title">Titel</label>
        <input
          id="node-title"
          className="field-control"
          value={title}
          autoFocus
          maxLength={120}
          placeholder="z. B. ETF-Zuflüsse steigen"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
        />
      </div>

      <div className="field">
        <span className="field-label" id="node-kind-label">
          Art
        </span>
        <div className="kind-picker" role="radiogroup" aria-labelledby="node-kind-label">
          {NODE_KINDS.map((k) => {
            const Icon = kindIcon[k];
            return (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`kind-option${kind === k ? " active" : ""}`} onClick={() => setKind(k)}>
                <Icon size={14} />
                {nodeKindLabel[k]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <label htmlFor="node-symbol">Symbol (optional)</label>
        <input
          id="node-symbol"
          className="field-control"
          list="node-symbol-list"
          value={symbol}
          maxLength={30}
          placeholder="z. B. BLK"
          onChange={(e) => setSymbol(e.target.value)}
        />
        <datalist id="node-symbol-list">
          {symbols.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <span className="field-hint">Verknüpft den Knoten mit deinen Positionen und Orders im Trading.</span>
      </div>

      <div className="field">
        <label htmlFor="node-text">Notiz</label>
        <textarea
          id="node-text"
          className="field-control node-text"
          value={text}
          maxLength={5000}
          placeholder="Was passiert hier und warum ist es wichtig?"
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {error && <p className="field-error">{error}</p>}

      {confirmDelete && node && (
        <ConfirmDialog
          title="Knoten löschen?"
          message={
            edgeCount === 0
              ? `„${node.title}“ wird dauerhaft gelöscht.`
              : `„${node.title}“ wird samt ${edgeCount} ${edgeCount === 1 ? "Verbindung" : "Verbindungen"} dauerhaft gelöscht.`
          }
          busy={busy}
          onConfirm={() => void run(() => deleteNode(node.id))}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
