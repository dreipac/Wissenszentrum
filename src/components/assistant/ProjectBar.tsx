import { FolderKanban, Pencil, Plus, Sparkles } from "lucide-react";
import type { DocPage } from "../../lib/docs";
import { docPath, type Project } from "../../lib/projects";
import "./Projects.css";

interface ProjectBarProps {
  projects: Project[];
  pages: DocPage[];
  activeId: number | null;
  /** Solange der Assistent antwortet, bleibt das Projekt, wie es ist */
  disabled: boolean;
  onSelect: (id: number | null) => void;
  onCreate: () => void;
  onEdit: (project: Project) => void;
}

/** Leiste links in der großen Ansicht: „Alle Daten“ und die Projekte mit ihrem Kontext aus der Dokumentation. */
export function ProjectBar({ projects, pages, activeId, disabled, onSelect, onCreate, onEdit }: ProjectBarProps) {
  return (
    <nav className="pj-bar" aria-label="Projekte">
      <div className="pj-head">
        <span>Projekte</span>
        <button type="button" className="icon-btn" aria-label="Neues Projekt" title="Neues Projekt" onClick={onCreate}>
          <Plus size={15} />
        </button>
      </div>

      <ul className="pj-list">
        <li>
          <button type="button" className={`pj-item${activeId === null ? " active" : ""}`} disabled={disabled && activeId !== null} onClick={() => onSelect(null)}>
            <Sparkles size={15} />
            <span className="pj-text">
              <span className="pj-name">Alle Daten</span>
              <span className="pj-sub">Ohne festen Kontext</span>
            </span>
          </button>
        </li>
        {projects.map((p) => {
          const path = docPath(pages, p.docId);
          return (
            <li key={p.id} className="pj-row">
              <button type="button" className={`pj-item${activeId === p.id ? " active" : ""}`} disabled={disabled && activeId !== p.id} onClick={() => onSelect(p.id)}>
                <FolderKanban size={15} />
                <span className="pj-text">
                  <span className="pj-name">{p.name}</span>
                  <span className="pj-sub">{path || (p.docId === null ? "Keine Dokumentation" : "Zuordnung entfällt")}</span>
                </span>
              </button>
              <button type="button" className="icon-btn pj-edit" aria-label={`Projekt „${p.name}“ bearbeiten`} title="Bearbeiten" onClick={() => onEdit(p)}>
                <Pencil size={13} />
              </button>
            </li>
          );
        })}
      </ul>

      {projects.length === 0 && (
        <p className="pj-empty">
          Ein Projekt gibt dem Assistenten einen festen Kontext aus deiner Dokumentation: Er weiß dann, wo Neues hingehört, ohne dass du es jedes Mal sagst.
        </p>
      )}

      <button type="button" className="pj-new" onClick={onCreate}>
        <Plus size={14} />
        Neues Projekt
      </button>
    </nav>
  );
}
