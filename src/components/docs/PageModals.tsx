import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { createDocPage, moveDocPage } from "../../lib/api/docs";
import { pageTitle, parentOptions, type DocKind, type DocNode, type DocPage } from "../../lib/docs";

const indent = (depth: number) => "   ".repeat(Math.max(0, depth - 1));

function ParentSelect({ id, value, tree, excludeId, onChange }: { id: string; value: number | null; tree: DocNode[]; excludeId?: number; onChange: (v: number | null) => void }) {
  return (
    <select id={id} className="field-control" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
      {parentOptions(tree, excludeId ?? null).map((o) => (
        <option key={o.id ?? "root"} value={o.id ?? ""}>
          {indent(o.depth)}
          {o.label}
        </option>
      ))}
    </select>
  );
}

interface NewPageModalProps {
  kind: DocKind;
  tree: DocNode[];
  /** Vorausgewählte Elternseite, null = Hauptebene */
  parentId: number | null;
  onCreated: (page: DocPage) => void;
  onClose: () => void;
}

export function NewPageModal({ kind, tree, parentId, onCreated, onClose }: NewPageModalProps) {
  const folder = kind === "folder";
  const [title, setTitle] = useState("");
  const [parent, setParent] = useState<number | null>(parentId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) return setError("Bitte gib einen Titel ein.");
    setBusy(true);
    setError(null);
    try {
      onCreated(await createDocPage(parent, title, kind));
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={folder ? "Neuer Ordner" : "Neue Seite"}
      width={480}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <Button disabled={busy} onClick={() => void save()}>
            {folder ? "Ordner erstellen" : "Seite erstellen"}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="page-title">Titel</label>
        <input
          id="page-title"
          className="field-control"
          value={title}
          autoFocus
          maxLength={200}
          placeholder={folder ? "z. B. Powershell" : "z. B. Netzwerk-Übersicht"}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
      </div>
      <div className="field">
        <label htmlFor="page-parent">Ablegen unter</label>
        <ParentSelect id="page-parent" value={parent} tree={tree} onChange={setParent} />
      </div>
      {error && <p className="field-error">{error}</p>}
    </Modal>
  );
}

interface MovePageModalProps {
  page: DocPage;
  tree: DocNode[];
  onClose: () => void;
}

export function MovePageModal({ page, tree, onClose }: MovePageModalProps) {
  const [parent, setParent] = useState<number | null>(page.parentId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await moveDocPage(page.id, parent);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Seite verschieben"
      width={480}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <Button disabled={busy || parent === page.parentId} onClick={() => void save()}>
            Verschieben
          </Button>
        </>
      }
    >
      <p className="muted">„{pageTitle(page)}“ wird samt Unterseiten ans Ende der gewählten Ebene gestellt.</p>
      <div className="field">
        <label htmlFor="move-parent">Neu ablegen unter</label>
        <ParentSelect id="move-parent" value={parent} tree={tree} excludeId={page.id} onChange={setParent} />
      </div>
      {error && <p className="field-error">{error}</p>}
    </Modal>
  );
}
