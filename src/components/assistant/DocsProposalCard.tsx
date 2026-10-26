import { AlertTriangle, BookPlus, Eye, FileText, Folder, FolderOpen } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import type { DocProposal } from "../../lib/api/assistant";
import type { DocNodeSpec } from "../../lib/docBlocks";
import { statChips } from "./DocsPreviewOverlay";

/** Wie weit ein Vorschlag ist: offen, wird gerade angelegt, angelegt oder verworfen. */
export type DocsStatus = "open" | "creating" | "created" | "dismissed";

export interface DocsItem {
  key: number;
  data: DocProposal;
  status: DocsStatus;
  error?: string;
  /** Nummer des ersten angelegten Eintrags, damit er sich öffnen lässt */
  firstId?: number;
}

interface DocsProposalCardProps {
  item: DocsItem;
  /** Öffnet die große Vorschau in der Mitte des Fensters */
  onPreview: () => void;
  onDismiss: () => void;
  onShow: () => void;
}

function TreeNode({ node }: { node: DocNodeSpec }) {
  return (
    <li>
      <div className="as-node-row">
        {node.type === "folder" ? <Folder size={14} className="as-node-icon folder" /> : <FileText size={14} className="as-node-icon" />}
        <span className="as-node-title">{node.title}</span>
      </div>
      {node.children.length > 0 && (
        <ul className="as-doctree nested">
          {node.children.map((c, i) => (
            <TreeNode key={`${i}-${c.title}`} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Vorschlag des Assistenten für neue Ordner und Seiten der Dokumentation als kompakte Karte im Chat. Den Inhalt prüft
 * und bestätigt man in der großen Vorschau („Vorschau öffnen“): der Chat ist dafür zu schmal.
 */
export function DocsProposalCard({ item, onPreview, onDismiss, onShow }: DocsProposalCardProps) {
  const { data, status, error } = item;
  const done = status === "created" || status === "dismissed";

  return (
    <article className={`as-proposal as-docs ${status}`} aria-label="Vorschlag für die Dokumentation">
      <header className="as-prop-head">
        <BookPlus size={14} />
        <span>{status === "created" ? "Angelegt" : status === "dismissed" ? "Verworfen" : "Dokumentation anlegen"}</span>
      </header>

      <p className="as-docs-target">
        <FolderOpen size={13} />
        <span>{data.parentId === null ? "In der Hauptebene" : `Unter ${data.parentPath}`}</span>
      </p>

      <ul className="as-doctree">
        {data.nodes.map((n, i) => (
          <TreeNode key={`${i}-${n.title}`} node={n} />
        ))}
      </ul>

      <div className="as-docs-stats">
        {statChips(data.stats).map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>

      {data.existing.length > 0 && !done && (
        <p className="as-prop-warn">
          <AlertTriangle size={13} />
          <span>Dort gibt es schon: {data.existing.join(", ")}.</span>
        </p>
      )}

      {error && !done && <p className="as-prop-error">{error}</p>}

      {!done && (
        <div className="as-prop-actions">
          <Button className="sm" disabled={status === "creating"} onClick={onPreview}>
            <Eye size={14} />
            {status === "creating" ? "Lege an …" : "Vorschau öffnen"}
          </Button>
          <SecondaryButton className="sm" disabled={status === "creating"} onClick={onDismiss}>
            Verwerfen
          </SecondaryButton>
        </div>
      )}

      {status === "created" && (
        <button type="button" className="as-prop-link" onClick={onShow}>
          In der Dokumentation öffnen
        </button>
      )}
    </article>
  );
}
