import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  FolderClosed,
  FolderInput,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "../components/ui/ContextMenu";
import { DocEditor } from "../components/docs/DocEditor";
import { DocExport } from "../components/docs/DocExport";
import { FolderView } from "../components/docs/FolderView";
import { MovePageModal, NewPageModal } from "../components/docs/PageModals";
import { deleteDocPage, placeDocPage, setDocFavorite, shiftDocPage } from "../lib/api/docs";
import { TreeDragLayer, useTreeDrag } from "../components/docs/useTreeDrag";
import { ancestors, buildTree, descendantIds, isFolder, pageTitle, searchPages, type DocKind, type DocNode, type DocPage } from "../lib/docs";
import { useOpenTarget } from "../lib/openTarget";
import { clearPendingDoc, onOpenDocRequest, peekPendingDoc } from "../lib/docsNav";
import { useDocs } from "../lib/useDocs";
import "./DocsView.css";

const ACTIVE_KEY = "docsActivePage";
const EXPANDED_KEY = "docsExpandedPages";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Merken ist nur Komfort */
  }
}

interface TreeRowProps {
  node: DocNode;
  expanded: Set<number>;
  activeId: number | null;
  onToggle: (id: number) => void;
  onSelect: (id: number) => void;
  onAdd: (id: number, x: number, y: number) => void;
  onMenu: (page: DocPage, x: number, y: number) => void;
  /** Mausdruck auf der Zeile (Ziehen im Baum) und ob gerade eine Seite gezogen wird */
  onRowDown: (page: DocPage, e: React.PointerEvent<HTMLElement>) => void;
  draggingId: number | null;
  wasDragged: () => boolean;
}

function TreeRow({ node, expanded, activeId, onToggle, onSelect, onAdd, onMenu, onRowDown, draggingId, wasDragged }: TreeRowProps) {
  const { page, children } = node;
  const open = expanded.has(page.id);
  const hasChildren = children.length > 0;
  const folder = isFolder(page);
  const Icon = folder ? (open ? FolderOpen : FolderClosed) : FileText;

  return (
    <li>
      <div
        className={`tree-row${activeId === page.id ? " active" : ""}${draggingId === page.id ? " dragged" : ""}`}
        data-page-id={page.id}
        onPointerDown={(e) => onRowDown(page, e)}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(page, e.clientX, e.clientY);
        }}
      >
        <button
          type="button"
          className={`tree-toggle${hasChildren ? "" : " hidden"}`}
          aria-label={open ? "Zuklappen" : "Aufklappen"}
          aria-expanded={hasChildren ? open : undefined}
          tabIndex={hasChildren ? 0 : -1}
          onClick={() => onToggle(page.id)}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <button
          type="button"
          className="tree-item"
          title={pageTitle(page)}
          onClick={() => {
            // Auf das Loslassen nach dem Ziehen folgt ein Klick: der soll nichts öffnen
            if (wasDragged()) return;
            onSelect(page.id);
            // Ordner klappen beim Öffnen auf
            if (folder && !open) onToggle(page.id);
          }}
        >
          <Icon size={15} />
          <span className={`tree-label${page.title.trim() ? "" : " untitled"}`}>{pageTitle(page)}</span>
          {page.favorite && <Star size={11} className="tree-fav" fill="currentColor" />}
        </button>
        {hasChildren && <span className="tree-count">{children.length}</span>}
        <span className="tree-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Hinzufügen"
            title="Seite oder Ordner hinzufügen"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onAdd(page.id, r.left, r.bottom + 4);
            }}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Mehr"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              onMenu(page, r.right - 190, r.bottom + 4);
            }}
          >
            <MoreHorizontal size={13} />
          </button>
        </span>
      </div>
      {hasChildren && open && (
        <ul className="tree-list nested">
          {children.map((c) => (
            <TreeRow key={c.page.id} node={c} expanded={expanded} activeId={activeId} onToggle={onToggle} onSelect={onSelect} onAdd={onAdd} onMenu={onMenu} onRowDown={onRowDown} draggingId={draggingId} wasDragged={wasDragged} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function DocsView() {
  const { pages, loaded, error } = useDocs();
  const [activeId, setActiveId] = useState<number | null>(() => peekPendingDoc() ?? readStored<number | null>(ACTIVE_KEY, null));
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(readStored<number[]>(EXPANDED_KEY, [])));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<{ kind: "new"; parentId: number | null; docKind: DocKind } | { kind: "move"; page: DocPage } | null>(null);
  const [deleting, setDeleting] = useState<DocPage | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(pages), [pages]);
  const active = pages.find((p) => p.id === activeId) ?? null;
  const hits = useMemo(() => searchPages(pages, query), [pages, query]);
  const trail = active ? ancestors(pages, active.id) : [];
  const subpages = active ? pages.filter((p) => p.parentId === active.id).sort((a, b) => a.position - b.position || a.id - b.id) : [];

  // Ohne gültige Auswahl die erste Seite öffnen
  useEffect(() => {
    if (!loaded || active || tree.length === 0) return;
    setActiveId(tree[0].page.id);
  }, [loaded, active, tree]);

  // „Neue Seite“ aus dem Schnellzugriff
  useOpenTarget("new-doc", () => setDialog({ kind: "new", parentId: active && isFolder(active) ? active.id : null, docKind: "page" }));

  // Wünsche „Seite öffnen“ (z. B. vom Dashboard) entgegennehmen
  useEffect(() => {
    clearPendingDoc();
    return onOpenDocRequest(() => {
      const id = peekPendingDoc();
      clearPendingDoc();
      if (id === null) return;
      setActiveId(id);
      setEditingId(null);
      setQuery("");
    });
  }, []);

  useEffect(() => writeStored(ACTIVE_KEY, activeId), [activeId]);
  useEffect(() => writeStored(EXPANDED_KEY, [...expanded]), [expanded]);

  // Die Eltern der geöffneten Seite sichtbar machen
  useEffect(() => {
    if (!active) return;
    const chain = ancestors(pages, active.id).map((p) => p.id);
    setExpanded((prev) => (chain.every((id) => prev.has(id)) ? prev : new Set([...prev, ...chain])));
    // nur beim Wechsel der Seite
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const select = (id: number) => {
    setActiveId(id);
    setEditingId(null);
  };

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(String(e));
    }
  };

  const siblingsOf = (page: DocPage) => pages.filter((p) => p.parentId === page.parentId).sort((a, b) => a.position - b.position || a.id - b.id);

  /** Auswahl, ob unter `parentId` (null = Hauptebene) eine Seite oder ein Ordner entstehen soll */
  const openAddMenu = (parentId: number | null, x: number, y: number) =>
    setMenu({
      x,
      y,
      items: [
        { label: "Neue Seite", icon: FilePlus2, onClick: () => setDialog({ kind: "new", parentId, docKind: "page" }) },
        { label: "Neuer Ordner", icon: FolderPlus, onClick: () => setDialog({ kind: "new", parentId, docKind: "folder" }) },
      ],
    });

  const openMenu = (page: DocPage, x: number, y: number) => {
    const siblings = siblingsOf(page);
    const index = siblings.findIndex((p) => p.id === page.id);
    const items: ContextMenuItem[] = [
      { label: "Neue Seite darin", icon: FilePlus2, onClick: () => setDialog({ kind: "new", parentId: page.id, docKind: "page" }) },
      { label: "Neuer Ordner darin", icon: FolderPlus, onClick: () => setDialog({ kind: "new", parentId: page.id, docKind: "folder" }) },
      { label: page.favorite ? "Favorit entfernen" : "Als Favorit markieren", icon: Star, onClick: () => void run(() => setDocFavorite(page.id, !page.favorite)) },
    ];
    if (index > 0) items.push({ label: "Nach oben", icon: ArrowUp, onClick: () => void run(() => shiftDocPage(page.id, -1)) });
    if (index < siblings.length - 1) items.push({ label: "Nach unten", icon: ArrowDown, onClick: () => void run(() => shiftDocPage(page.id, 1)) });
    items.push(
      { label: "Verschieben …", icon: FolderInput, onClick: () => setDialog({ kind: "move", page }) },
      { label: "Löschen", icon: Trash2, onClick: () => setDeleting(page) },
    );
    setMenu({ x, y, items });
  };

  const remove = async (page: DocPage) => {
    setDeleting(null);
    try {
      await deleteDocPage(page.id);
      if (activeId === page.id || descendantIds(pages, page.id).includes(activeId ?? -1)) {
        setActiveId(page.parentId);
        setEditingId(null);
      }
    } catch (e) {
      setActionError(String(e));
    }
  };

  // Ziehen im Baum: umsortieren, in andere Ordner oder Seiten setzen
  const treeScroll = useRef<HTMLDivElement>(null);
  const { dragging, drop, onRowPointerDown, wasDragged } = useTreeDrag({
    pages,
    tree,
    expanded,
    setExpanded,
    scroller: treeScroll,
    onDrop: (page, parentId, index) => void run(() => placeDocPage(page.id, parentId, index)),
  });

  const created = (page: DocPage) => {
    setActiveId(page.id);
    setEditingId(isFolder(page) ? null : page.id);
    setQuery("");
    if (page.parentId !== null) setExpanded((prev) => new Set([...prev, page.parentId!]));
  };

  const folderCount = pages.filter(isFolder).length;
  const pageCount = pages.length - folderCount;
  const deletingCount = deleting ? descendantIds(pages, deleting.id).length : 0;
  const searching = query.trim() !== "";

  return (
    <div className="docs-layout">
      <aside className="docs-tree-pane">
        <header className="docs-tree-head">
          <div className="page-title-row">
            <h1 className="page-title">Dokumentation</h1>
            <button
              type="button"
              className="icon-btn"
              aria-label="Hinzufügen"
              title="Seite oder Ordner hinzufügen"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openAddMenu(null, r.right - 170, r.bottom + 4);
              }}
            >
              <Plus size={16} />
            </button>
          </div>
          <label className="input">
            <Search size={14} />
            <input placeholder="Seiten durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </header>

        <div className="docs-tree-scroll" ref={treeScroll}>
          {searching ? (
            <ul className="docs-hits">
              {hits.map(({ page, snippet }) => {
                const path = ancestors(pages, page.id).map(pageTitle);
                return (
                  <li key={page.id}>
                    <button
                      type="button"
                      className={`docs-hit${page.id === activeId ? " active" : ""}`}
                      onClick={() => {
                        select(page.id);
                        setQuery("");
                      }}
                    >
                      <span className="docs-hit-title">{pageTitle(page)}</span>
                      {path.length > 0 && <span className="docs-hit-path">{path.join(" › ")}</span>}
                      {snippet && <span className="docs-hit-snippet">{snippet}</span>}
                    </button>
                  </li>
                );
              })}
              {hits.length === 0 && <li className="docs-empty-list muted">Keine Seiten gefunden.</li>}
            </ul>
          ) : (
            <>
              <ul className="tree-list root">
                {tree.map((n) => (
                  <TreeRow
                    key={n.page.id}
                    node={n}
                    expanded={expanded}
                    activeId={activeId}
                    onToggle={toggle}
                    onSelect={select}
                    onAdd={openAddMenu}
                    onMenu={openMenu}
                    onRowDown={onRowPointerDown}
                    draggingId={dragging?.page.id ?? null}
                    wasDragged={wasDragged}
                  />
                ))}
              </ul>
              {loaded && tree.length === 0 && <p className="docs-empty-list muted">Noch keine Seiten.</p>}
            </>
          )}
        </div>
        {!searching && pages.length > 0 && (
          <footer className="docs-tree-foot">
            {folderCount} {folderCount === 1 ? "Ordner" : "Ordner"} · {pageCount} {pageCount === 1 ? "Seite" : "Seiten"}
          </footer>
        )}
      </aside>

      <TreeDragLayer dragging={dragging} drop={drop} />

      <section className="docs-page-pane">
        {active ? (
          <>
            <header className="docs-page-head">
              <nav className="breadcrumbs" aria-label="Pfad">
                <span>Dokumentation</span>
                {trail.map((p) => (
                  <span key={p.id} className="crumb">
                    <ChevronRight size={12} />
                    <button type="button" onClick={() => select(p.id)}>
                      {pageTitle(p)}
                    </button>
                  </span>
                ))}
                <ChevronRight size={12} />
                <span className="current">{pageTitle(active)}</span>
              </nav>
              <div className="page-actions">
                <button
                  type="button"
                  className={`icon-btn${active.favorite ? " active" : ""}`}
                  aria-label={active.favorite ? "Favorit entfernen" : "Als Favorit markieren"}
                  title={active.favorite ? "Favorit entfernen" : "Als Favorit markieren"}
                  aria-pressed={active.favorite}
                  onClick={() => void run(() => setDocFavorite(active.id, !active.favorite))}
                >
                  <Star size={16} fill={active.favorite ? "currentColor" : "none"} />
                </button>
                <DocExport
                  page={active}
                  pages={pages}
                  // Wer gerade schreibt, hat Änderungen, die erst nach kurzer Zeit gespeichert sind: Bearbeiten beenden speichert sofort
                  beforeExport={async () => {
                    if (editingId !== active.id) return;
                    setEditingId(null);
                    await new Promise((resolve) => window.setTimeout(resolve, 700));
                  }}
                />
                {isFolder(active) ? null : editingId === active.id ? (
                  <Button className="sm" onClick={() => setEditingId(null)}>
                    <Check size={14} />
                    Fertig
                  </Button>
                ) : (
                  <SecondaryButton className="sm" onClick={() => setEditingId(active.id)}>
                    <Pencil size={14} />
                    Bearbeiten
                  </SecondaryButton>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Mehr"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    openMenu(active, r.right - 190, r.bottom + 4);
                  }}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </header>

            {(actionError || error) && <p className="field-error docs-error">{actionError ?? error}</p>}

            {isFolder(active) ? (
              <FolderView
                key={active.id}
                folder={active}
                items={subpages}
                pages={pages}
                onOpen={select}
                onNew={(docKind) => setDialog({ kind: "new", parentId: active.id, docKind })}
              />
            ) : (
              <DocEditor
                key={active.id}
                page={active}
                editing={editingId === active.id}
                  subpages={subpages}
                onOpen={select}
              />
            )}
          </>
        ) : (
          loaded && (
            <div className="docs-blank">
              <h2>Deine Dokumentation</h2>
              <p className="muted">
                Halte Bleibendes fest: Anleitungen, Prozesse, Wissen. Seiten lassen sich beliebig verschachteln. Für kurzlebige Gedanken sind die Notizen da.
              </p>
              <div className="docs-blank-actions">
                <Button onClick={() => setDialog({ kind: "new", parentId: null, docKind: "page" })}>
                  <FilePlus2 size={16} />
                  Erste Seite anlegen
                </Button>
                <SecondaryButton onClick={() => setDialog({ kind: "new", parentId: null, docKind: "folder" })}>
                  <FolderPlus size={16} />
                  Ordner anlegen
                </SecondaryButton>
              </div>
            </div>
          )
        )}
      </section>

      {dialog?.kind === "new" && <NewPageModal kind={dialog.docKind} tree={tree} parentId={dialog.parentId} onCreated={created} onClose={() => setDialog(null)} />}
      {dialog?.kind === "move" && <MovePageModal page={dialog.page} tree={tree} onClose={() => setDialog(null)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {deleting && (
        <ConfirmDialog
          title={isFolder(deleting) ? "Ordner löschen?" : "Seite löschen?"}
          message={
            deletingCount === 0
              ? `„${pageTitle(deleting)}“ wird dauerhaft gelöscht.`
              : isFolder(deleting)
                ? `„${pageTitle(deleting)}“ wird samt ${deletingCount} ${deletingCount === 1 ? "Eintrag" : "Einträgen"} dauerhaft gelöscht.`
                : `„${pageTitle(deleting)}“ wird samt ${deletingCount} ${deletingCount === 1 ? "Unterseite" : "Unterseiten"} dauerhaft gelöscht.`
          }
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
