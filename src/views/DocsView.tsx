import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  FolderClosed,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { docTree, type DocNode } from "../data/mock";
import "./DocsView.css";

function TreeItem({
  node,
  depth,
  openIds,
  activeId,
  onToggle,
  onSelect,
}: {
  node: DocNode;
  depth: number;
  openIds: Set<string>;
  activeId: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = !!node.children?.length;
  const open = openIds.has(node.id);
  const Icon = hasChildren ? (open ? FolderOpen : FolderClosed) : FileText;

  return (
    <li>
      <button
        type="button"
        className={`tree-item${activeId === node.id ? " active" : ""}`}
        style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
        onClick={() => (hasChildren ? onToggle(node.id) : onSelect(node.id))}
      >
        <span className="tree-chevron">
          {hasChildren ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </span>
        <Icon size={15} />
        <span className="tree-label">{node.title}</span>
      </button>
      {hasChildren && open && (
        <ul className="tree-list">
          {node.children!.map((c) => (
            <TreeItem
              key={c.id}
              node={c}
              depth={depth + 1}
              openIds={openIds}
              activeId={activeId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function DocsView() {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(["d2"]));
  const [activeId, setActiveId] = useState("d2a");

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="docs-layout">
      <aside className="docs-tree-pane">
        <header className="docs-tree-head">
          <div className="page-title-row">
            <h1 className="page-title">Dokumentation</h1>
            <button type="button" className="icon-btn" aria-label="Neue Seite">
              <Plus size={16} />
            </button>
          </div>
          <label className="input">
            <Search size={14} />
            <input placeholder="Seiten durchsuchen …" />
          </label>
        </header>
        <ul className="tree-list root">
          {docTree.map((n) => (
            <TreeItem
              key={n.id}
              node={n}
              depth={0}
              openIds={openIds}
              activeId={activeId}
              onToggle={toggle}
              onSelect={setActiveId}
            />
          ))}
        </ul>
      </aside>

      <section className="docs-page-pane">
        <header className="docs-page-head">
          <nav className="breadcrumbs" aria-label="Pfad">
            <span>Dokumentation</span>
            <ChevronRight size={12} />
            <span>IT-Infrastruktur</span>
            <ChevronRight size={12} />
            <span className="current">Netzwerk-Übersicht</span>
          </nav>
          <div className="page-actions">
            <button type="button" className="icon-btn" aria-label="Favorit">
              <Star size={16} />
            </button>
            <SecondaryButton className="sm">
              <Clock size={14} />
              Verlauf
            </SecondaryButton>
            <Button className="sm">
              <Pencil size={14} />
              Bearbeiten
            </Button>
            <button type="button" className="icon-btn" aria-label="Mehr">
              <MoreHorizontal size={16} />
            </button>
          </div>
        </header>

        <div className="docs-scroll">
          <article className="doc-article">
            <h1 className="doc-title">Netzwerk-Übersicht</h1>
            <div className="doc-meta">
              <span className="avatar">AD</span>
              <span>Armin</span>
              <span className="doc-meta-dot">·</span>
              <span>Zuletzt aktualisiert vor 2 Tagen</span>
              <span className="tag">Entwurf</span>
            </div>

            <h2 id="ziel">Ziel</h2>
            <p>
              Diese Seite dokumentiert den Aufbau des Firmennetzwerks: Segmente, wichtige Geräte,
              Zugänge und Zuständigkeiten. Sie dient als Einstiegspunkt für Wartung und Fehlersuche.
            </p>

            <h2 id="segmente">Netzwerksegmente</h2>
            <div className="card doc-table">
              <div className="doc-row head">
                <span>Segment</span>
                <span>Bereich</span>
                <span>Gateway</span>
              </div>
              <div className="doc-row">
                <span>Büro</span>
                <span>192.168.10.0/24</span>
                <span>192.168.10.1</span>
              </div>
              <div className="doc-row">
                <span>Server</span>
                <span>192.168.20.0/24</span>
                <span>192.168.20.1</span>
              </div>
              <div className="doc-row">
                <span>Gäste</span>
                <span>192.168.30.0/24</span>
                <span>192.168.30.1</span>
              </div>
            </div>

            <h2 id="zugaenge">Zugänge</h2>
            <p>
              Administrative Zugänge werden ausschließlich über den Passwortmanager verwaltet. Für
              Fernzugriff ist zuvor das VPN zu aktivieren.
            </p>
          </article>

          <aside className="doc-outline">
            <span className="card-title">Auf dieser Seite</span>
            <a className="active" href="#ziel">Ziel</a>
            <a href="#segmente">Netzwerksegmente</a>
            <a href="#zugaenge">Zugänge</a>
          </aside>
        </div>
      </section>
    </div>
  );
}
