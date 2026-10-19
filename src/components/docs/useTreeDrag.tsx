import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction } from "react";
import { FileText, FolderClosed } from "lucide-react";
import { MAX_DEPTH, ancestors, descendantIds, isFolder, pageTitle, subtreeHeight, type DocNode, type DocPage } from "../../lib/docs";

/** Erst ab dieser Strecke (Pixel) gilt eine Mausbewegung als Ziehen, kürzere Bewegungen bleiben ein Klick */
const START_DISTANCE = 5;
const EDGE = 36;
const SCROLL_SPEED = 10;
/** Wie lange der Zeiger auf einem zugeklappten Ordner ruhen muss, bis er sich öffnet */
const OPEN_DELAY_MS = 650;

interface Drop {
  parentId: number | null;
  index: number;
  /** Linie zwischen zwei Zeilen oder Umrandung der Zeile, in die hinein abgelegt wird */
  mode: "line" | "into";
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Options {
  pages: DocPage[];
  tree: DocNode[];
  expanded: Set<number>;
  setExpanded: Dispatch<SetStateAction<Set<number>>>;
  /** Scrollender Bereich mit den Zeilen */
  scroller: RefObject<HTMLElement | null>;
  /** Wird beim Loslassen an einer gültigen Stelle aufgerufen */
  onDrop: (page: DocPage, parentId: number | null, index: number) => void;
}

const findNode = (nodes: DocNode[], id: number): DocNode | null => {
  for (const n of nodes) {
    if (n.page.id === id) return n;
    const inner = findNode(n.children, id);
    if (inner) return inner;
  }
  return null;
};

/**
 * Ziehen im Seitenbaum mit der Maus: Zeile anfassen und über eine andere Zeile bewegen. Oberes Viertel einer Zeile =
 * davor einfügen, unteres Viertel = dahinter, Mitte = hinein (als letzte Unterseite). Eine Linie bzw. Umrandung zeigt
 * vorab, wohin die Seite kommt. Ungültige Ziele (in sich selbst, zu tief) zeigen nichts an.
 */
export function useTreeDrag({ pages, tree, expanded, setExpanded, scroller, onDrop }: Options) {
  const [dragging, setDragging] = useState<{ page: DocPage; x: number; y: number } | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const justDragged = useRef(false);
  const latest = useRef({ pages, tree, expanded });
  latest.current = { pages, tree, expanded };
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  /** Wohin käme die Seite bei diesem Zeigerstand? null = nirgends (ungültig oder außerhalb). */
  const plan = useCallback(
    (page: DocPage, y: number): { drop: Drop; openId: number | null } | null => {
      const box = scroller.current;
      if (!box) return null;
      const { pages: all, tree: nodes, expanded: open } = latest.current;
      const rows = [...box.querySelectorAll<HTMLElement>(".tree-row[data-page-id]")];
      if (rows.length === 0) return null;
      const bad = new Set([page.id, ...descendantIds(all, page.id)]);
      const movedHeight = subtreeHeight(findNode(nodes, page.id) ?? { page, children: [] });
      const depthOf = (id: number | null) => (id === null ? 0 : ancestors(all, id).length + 1);
      const childrenOf = (parent: number | null) => all.filter((p) => p.parentId === parent && p.id !== page.id).sort((a, b) => a.position - b.position || a.id - b.id);
      const allowed = (parent: number | null) => !(parent !== null && bad.has(parent)) && depthOf(parent) + movedHeight <= MAX_DEPTH;

      const boxRect = box.getBoundingClientRect();
      const first = rows[0].getBoundingClientRect();
      const last = rows[rows.length - 1].getBoundingClientRect();
      const left = boxRect.left + 6;
      const width = boxRect.width - 12;

      // Unter der letzten Zeile: ans Ende der Hauptebene
      if (y > last.bottom) {
        const index = childrenOf(null).length;
        return allowed(null) ? { drop: { parentId: null, index, mode: "line", top: last.bottom + 1, left, width, height: 2 }, openId: null } : null;
      }
      if (y < first.top) {
        return allowed(null) ? { drop: { parentId: null, index: 0, mode: "line", top: first.top - 1, left, width, height: 2 }, openId: null } : null;
      }

      const row = rows.find((r) => {
        const rect = r.getBoundingClientRect();
        return y >= rect.top - 1 && y <= rect.bottom + 1;
      });
      if (!row) return null;
      const rect = row.getBoundingClientRect();
      const target = all.find((p) => p.id === Number(row.dataset.pageId));
      if (!target) return null;
      const node = findNode(nodes, target.id);
      const hasVisibleChildren = !!node && node.children.length > 0 && open.has(target.id);
      const ratio = (y - rect.top) / rect.height;
      const lineLeft = rect.left + 4;
      const lineWidth = Math.max(rect.width - 8, 40);

      if (ratio < 0.28) {
        const siblings = childrenOf(target.parentId);
        const at = siblings.findIndex((p) => p.id === target.id);
        return allowed(target.parentId) ? { drop: { parentId: target.parentId, index: Math.max(at, 0), mode: "line", top: rect.top - 1, left: lineLeft, width: lineWidth, height: 2 }, openId: null } : null;
      }
      if (ratio > 0.72) {
        // Hinter einer aufgeklappten Zeile mit Unterseiten beginnt deren Liste
        if (hasVisibleChildren) {
          return allowed(target.id) ? { drop: { parentId: target.id, index: 0, mode: "line", top: rect.bottom, left: lineLeft + 16, width: Math.max(lineWidth - 16, 40), height: 2 }, openId: null } : null;
        }
        const siblings = childrenOf(target.parentId);
        const at = siblings.findIndex((p) => p.id === target.id);
        return allowed(target.parentId) ? { drop: { parentId: target.parentId, index: at + 1, mode: "line", top: rect.bottom, left: lineLeft, width: lineWidth, height: 2 }, openId: null } : null;
      }
      // Mitte: hinein
      if (!allowed(target.id)) return null;
      const count = childrenOf(target.id).length;
      const closed = !open.has(target.id) && (node?.children.length ?? 0) > 0;
      return { drop: { parentId: target.id, index: count, mode: "into", top: rect.top, left: rect.left, width: rect.width, height: rect.height }, openId: closed ? target.id : null };
    },
    [scroller],
  );

  /** Mausdruck auf einer Zeile: ab START_DISTANCE beginnt das Ziehen. */
  const onRowPointerDown = useCallback(
    (page: DocPage, e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const target = e.target as Element;
      // Pfeil und die Knöpfe rechts bleiben normale Knöpfe
      if (target.closest(".tree-toggle, .tree-actions")) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let active = false;
      let pointer = { x: startX, y: startY };
      let latestDrop: Drop | null = null;
      let timer: number | undefined;
      let openingId: number | null = null;
      let loop: number | undefined;

      const refresh = () => {
        const result = plan(page, pointer.y);
        latestDrop = result?.drop ?? null;
        setDrop(latestDrop);
        // Zugeklappten Ordner nach kurzem Verweilen öffnen
        const wantOpen = result?.openId ?? null;
        if (wantOpen !== openingId) {
          window.clearTimeout(timer);
          openingId = wantOpen;
          if (wantOpen !== null) timer = window.setTimeout(() => setExpanded((prev) => new Set([...prev, wantOpen])), OPEN_DELAY_MS);
        }
      };

      const move = (ev: PointerEvent) => {
        pointer = { x: ev.clientX, y: ev.clientY };
        if (!active) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < START_DISTANCE) return;
          active = true;
          document.body.classList.add("tree-dragging");
          // Am Rand scrollen, damit auch weit entfernte Ziele erreichbar sind
          loop = window.setInterval(() => {
            const box = scroller.current;
            if (!box) return;
            const r = box.getBoundingClientRect();
            const dy = pointer.y > r.bottom - EDGE ? SCROLL_SPEED : pointer.y < r.top + EDGE ? -SCROLL_SPEED : 0;
            if (dy !== 0) {
              box.scrollTop += dy;
              refresh();
            }
          }, 30);
        }
        setDragging({ page, x: ev.clientX, y: ev.clientY });
        refresh();
      };

      const finish = (apply: boolean) => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", cancel, true);
        window.removeEventListener("keydown", key, true);
        window.clearTimeout(timer);
        window.clearInterval(loop);
        cleanup.current = null;
        if (!active) return;
        document.body.classList.remove("tree-dragging");
        setDragging(null);
        setDrop(null);
        // Der Klick, der auf das Loslassen folgt, soll nichts öffnen
        justDragged.current = true;
        window.setTimeout(() => (justDragged.current = false), 0);
        if (apply && latestDrop) {
          if (latestDrop.mode === "into") setExpanded((prev) => new Set([...prev, latestDrop!.parentId!]));
          onDropRef.current(page, latestDrop.parentId, latestDrop.index);
        }
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      const key = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.stopImmediatePropagation();
        finish(false);
      };

      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
      window.addEventListener("keydown", key, true);
      cleanup.current = () => finish(false);
    },
    [plan, scroller, setExpanded],
  );

  return { dragging, drop, onRowPointerDown, wasDragged: () => justDragged.current };
}

interface LayerProps {
  dragging: { page: DocPage; x: number; y: number } | null;
  drop: Drop | null;
}

/** Schwebende Anzeige beim Ziehen: Kopie der Zeile an der Maus und die Ablagemarke. */
export function TreeDragLayer({ dragging, drop }: LayerProps) {
  if (!dragging) return null;
  const folder = isFolder(dragging.page);
  return (
    <>
      {drop && <div className={`tree-drop ${drop.mode}`} style={{ top: drop.top, left: drop.left, width: drop.width, height: drop.height }} aria-hidden="true" />}
      <div className="tree-ghost" style={{ left: dragging.x + 14, top: dragging.y + 10 }} aria-hidden="true">
        {folder ? <FolderClosed size={15} /> : <FileText size={15} />}
        <span>{pageTitle(dragging.page)}</span>
      </div>
    </>
  );
}
