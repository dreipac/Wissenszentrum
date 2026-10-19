import { useState } from "react";
import { ChevronRight, FileText, FilePlus2, FolderClosed, FolderPlus } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { updateDocPage } from "../../lib/api/docs";
import { isFolder, pageTitle, type DocKind, type DocPage } from "../../lib/docs";
import { formatNoteTime } from "../../lib/notes";

interface FolderViewProps {
  folder: DocPage;
  /** Direkte Einträge des Ordners in Reihenfolge */
  items: DocPage[];
  /** Alle Seiten, um die Einträge der Unterordner zu zählen */
  pages: DocPage[];
  onOpen: (id: number) => void;
  onNew: (kind: DocKind) => void;
}

const countLabel = (n: number) => `${n} ${n === 1 ? "Eintrag" : "Einträge"}`;

/** Inhalt eines Ordners: Name (direkt änderbar) und seine Einträge als Karten. Pro Ordner neu einsetzen (`key`). */
export function FolderView({ folder, items, pages, onOpen, onNew }: FolderViewProps) {
  const [title, setTitle] = useState(folder.title);
  const [error, setError] = useState<string | null>(null);

  const commit = async () => {
    if (title.trim() === folder.title) return;
    try {
      await updateDocPage(folder.id, { title, content: "", plain: "" });
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="doc-body">
      <div className="docs-scroll">
        <article className="doc-article wide">
          <div className="folder-head">
            <span className="folder-icon" aria-hidden>
              <FolderClosed size={22} />
            </span>
            <input
              className="doc-title-input"
              value={title}
              placeholder="Name des Ordners"
              aria-label="Name des Ordners"
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          </div>
          <div className="doc-meta">
            <span>{countLabel(items.length)}</span>
            <span className="doc-meta-dot">·</span>
            <span>Erstellt {formatNoteTime(folder.createdAt)}</span>
          </div>
          {error && <p className="field-error">{error}</p>}

          <div className="folder-actions">
            <Button className="sm" onClick={() => onNew("page")}>
              <FilePlus2 size={14} />
              Neue Seite
            </Button>
            <SecondaryButton className="sm" onClick={() => onNew("folder")}>
              <FolderPlus size={14} />
              Neuer Ordner
            </SecondaryButton>
          </div>

          {items.length === 0 ? (
            <p className="muted folder-empty">Dieser Ordner ist noch leer.</p>
          ) : (
            <ul className="doc-list">
              {items.map((item) => {
                const children = pages.filter((p) => p.parentId === item.id).length;
                const folder = isFolder(item);
                return (
                  <li key={item.id}>
                    <button type="button" className="doc-row" onClick={() => onOpen(item.id)}>
                      {folder ? <FolderClosed size={16} /> : <FileText size={16} />}
                      <span className="doc-row-title">{pageTitle(item)}</span>
                      <span className="doc-row-meta">
                        {folder ? countLabel(children) : children > 0 ? `${children} ${children === 1 ? "Unterseite" : "Unterseiten"}` : `Bearbeitet ${formatNoteTime(item.updatedAt)}`}
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      </div>
    </div>
  );
}
