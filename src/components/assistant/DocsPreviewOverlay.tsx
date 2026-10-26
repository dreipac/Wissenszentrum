import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookPlus, FileText, Folder, X } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { useEditorTheme } from "../../lib/editorTheme";
import type { DocNodeSpec, DocStats } from "../../lib/docBlocks";
import { DocPageBlocks } from "./DocPagePreview";
import type { DocsItem } from "./DocsProposalCard";
import "../../views/NotesView.css";
import "../../views/DocsView.css";
import "./DocsPreview.css";

interface FlatNode {
  node: DocNodeSpec;
  /** Wo der Eintrag liegt: Titel der Ordner und Seiten darüber */
  trail: string[];
  depth: number;
  /** Eindeutig innerhalb des Vorschlags */
  id: string;
}

/** Der Baum als Liste in Anzeigereihenfolge, jeder Eintrag mit seinem Pfad. */
function flatten(nodes: DocNodeSpec[], trail: string[] = [], depth = 0, prefix = ""): FlatNode[] {
  return nodes.flatMap((node, i) => {
    const id = `${prefix}${i}`;
    return [{ node, trail, depth, id }, ...flatten(node.children, [...trail, node.title], depth + 1, `${id}.`)];
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function statChips(stats: DocStats): string[] {
  return [
    stats.folders > 0 && plural(stats.folders, "Ordner", "Ordner"),
    stats.pages > 0 && plural(stats.pages, "Seite", "Seiten"),
    stats.headings > 0 && plural(stats.headings, "Überschrift", "Überschriften"),
    stats.tables > 0 && plural(stats.tables, "Tabelle", "Tabellen"),
    stats.dividers > 0 && plural(stats.dividers, "Trennlinie", "Trennlinien"),
  ].filter(Boolean) as string[];
}

interface DocsPreviewOverlayProps {
  item: DocsItem;
  onCreate: () => void;
  /** Schließt die Vorschau, der Vorschlag bleibt im Chat offen */
  onClose: () => void;
  onDiscard: () => void;
}

/**
 * Große Vorschau eines Dokumentationsvorschlags in der Mitte des Fensters: links die Struktur zum Anklicken, rechts die
 * ausgewählte Seite so, wie sie später aussieht (gleiche Gestaltung wie im Editor, auch im gewählten Farbschema).
 * Bestätigt wird hier, nicht im schmalen Chat.
 */
export function DocsPreviewOverlay({ item, onCreate, onClose, onDiscard }: DocsPreviewOverlayProps) {
  const { data, status, error } = item;
  const { theme } = useEditorTheme();
  const flat = useMemo(() => flatten(data.nodes), [data.nodes]);
  // Zuerst die erste Seite zeigen, sonst den ersten Eintrag
  const [selectedId, setSelectedId] = useState(() => (flat.find((f) => f.node.type === "page") ?? flat[0])?.id ?? "");
  const selected = flat.find((f) => f.id === selectedId) ?? flat[0];
  const busy = status === "creating";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const path = [data.parentId === null ? "Hauptebene" : data.parentPath, ...(selected?.trail ?? [])];

  return (
    <div className="dpv-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dpv" role="dialog" aria-modal="true" aria-label="Vorschau: Dokumentation anlegen">
        <header className="dpv-head">
          <span className="dpv-head-icon">
            <BookPlus size={17} />
          </span>
          <div className="dpv-head-text">
            <h2>Dokumentation anlegen</h2>
            <p>
              {data.parentId === null ? "In der Hauptebene" : "Unter"} {data.parentId !== null && <strong>{data.parentPath}</strong>}
            </p>
          </div>
          <div className="dpv-stats">
            {statChips(data.stats).map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <button type="button" className="icon-btn" aria-label="Vorschau schließen" title="Schließen (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="dpv-body">
          <nav className="dpv-tree" aria-label="Struktur">
            <span className="dpv-label">Struktur</span>
            <ul>
              {flat.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className={`dpv-node${f.id === selected?.id ? " active" : ""}`}
                    style={{ paddingLeft: `${0.55 + f.depth * 0.95}rem` }}
                    onClick={() => setSelectedId(f.id)}
                  >
                    {f.node.type === "folder" ? <Folder size={14} /> : <FileText size={14} />}
                    <span>{f.node.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="dpv-stage docs-scroll" data-editor-theme={theme}>
            {selected && (
              <article className="doc-article dpv-article">
                <p className="dpv-path">{path.join(" › ")}</p>
                <h1 className="dpv-title">{selected.node.title}</h1>
                <div className="doc-meta">
                  <span>{selected.node.type === "folder" ? "Ordner" : "Vorschau"}</span>
                  <span className="doc-meta-dot">·</span>
                  <span>noch nicht angelegt</span>
                </div>
                {selected.node.type === "folder" ? (
                  <div className="dpv-folder">
                    <p>Dieser Ordner enthält:</p>
                    <ul>
                      {selected.node.children.map((c, i) => (
                        <li key={`${i}-${c.title}`}>
                          {c.type === "folder" ? <Folder size={14} /> : <FileText size={14} />}
                          {c.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : selected.node.blocks.length === 0 ? (
                  <p className="dpv-empty">Diese Seite wird leer angelegt.</p>
                ) : (
                  <div className="note-prose doc-prose">
                    <DocPageBlocks blocks={selected.node.blocks} />
                  </div>
                )}
              </article>
            )}
          </div>
        </div>

        <footer className="dpv-foot">
          <div className="dpv-notes">
            {data.existing.length > 0 && (
              <p className="dpv-warn">
                <AlertTriangle size={13} />
                <span>Dort gibt es schon: {data.existing.join(", ")}. Es entstehen Einträge mit demselben Titel.</span>
              </p>
            )}
            {error && <p className="dpv-error">{error}</p>}
          </div>
          <SecondaryButton disabled={busy} onClick={onDiscard}>
            Verwerfen
          </SecondaryButton>
          <Button disabled={busy} onClick={onCreate}>
            {busy ? "Lege an …" : "Anlegen"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
