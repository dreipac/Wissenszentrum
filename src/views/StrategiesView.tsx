import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Link2,
  Maximize,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "../components/ui/ContextMenu";
import { EdgeModal } from "../components/strategies/EdgeModal";
import { NodeModal } from "../components/strategies/NodeModal";
import { StrategyModal } from "../components/strategies/StrategyModal";
import { kindIcon } from "../components/strategies/kinds";
import { deleteNode, moveNode } from "../lib/api/strategies";
import { loadTradingState } from "../lib/api/trading";
import { onChange } from "../lib/changes";
import { useNavigate } from "../lib/navigation";
import { formatNoteTime } from "../lib/notes";
import {
  NODE_HEIGHT,
  NODE_KINDS,
  NODE_WIDTH,
  edgeGeometry,
  freeSpot,
  nodeKindLabel,
  type GraphEdge,
  type GraphNode,
  type Point,
  type Strategy,
} from "../lib/strategies";
import type { Trade } from "../lib/trading";
import { useStrategies } from "../lib/useStrategies";
import "./StrategiesView.css";

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
/** Zusätzlicher Platz rechts und unten, damit man Knoten weiter hinaus ziehen kann */
const ROOM = 320;
const DRAG_THRESHOLD = 4;

type ModalState =
  | { kind: "node"; node?: GraphNode; position?: Point }
  | { kind: "edge"; edge?: GraphEdge; from?: number; to?: number }
  | null;

interface ConnectState {
  /** Ausgangsknoten, null = noch nicht gewählt */
  from: number | null;
  /** true = vom Griff gezogen, false = per Klick auf zwei Knoten */
  drag: boolean;
  pointer: Point | null;
}

const counts = (s: Strategy) =>
  `${s.nodes.length} Knoten · ${s.edges.length} ${s.edges.length === 1 ? "Verbindung" : "Verbindungen"}`;

/** Hält den Zeiger am Element fest, damit Ziehen auch außerhalb weiterläuft; ohne aktiven Zeiger passiert nichts. */
function capture(e: ReactPointerEvent<HTMLElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    /* Zeiger nicht mehr aktiv */
  }
}

/** Positionen und Orders aus dem Trading, damit Knoten mit Symbol ihre Verknüpfung zeigen können. */
function useTradeRefs(): Pick<Trade, "symbol" | "status">[] {
  const [trades, setTrades] = useState<Pick<Trade, "symbol" | "status">[]>([]);
  useEffect(() => {
    const load = () =>
      loadTradingState()
        .then((s) => setTrades(s.trades.map((t) => ({ symbol: t.symbol, status: t.status }))))
        .catch(() => setTrades([]));
    void load();
    return onChange("trading", load);
  }, []);
  return trades;
}

function Inspector({
  node,
  strategy,
  trades,
  onSelect,
  onEdit,
  onConnect,
  onEditEdge,
  onClose,
}: {
  node: GraphNode;
  strategy: Strategy;
  trades: Pick<Trade, "symbol" | "status">[];
  onSelect: (id: number) => void;
  onEdit: () => void;
  onConnect: () => void;
  onEditEdge: (edge: GraphEdge) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const Icon = kindIcon[node.kind];
  const title = (id: number) => strategy.nodes.find((n) => n.id === id)?.title ?? "";
  const incoming = strategy.edges.filter((e) => e.to === node.id);
  const outgoing = strategy.edges.filter((e) => e.from === node.id);

  const related = node.symbol ? trades.filter((t) => t.symbol.toUpperCase() === node.symbol) : [];
  const open = related.filter((t) => t.status === "open").length;
  const orders = related.filter((t) => t.status === "order").length;
  const closed = related.filter((t) => t.status === "closed").length;
  const summary = [
    open > 0 && `${open} ${open === 1 ? "Position" : "Positionen"}`,
    orders > 0 && `${orders} ${orders === 1 ? "Order" : "Orders"}`,
    closed > 0 && `${closed} geschlossen`,
  ]
    .filter(Boolean)
    .join(" · ");

  const link = (e: GraphEdge, otherId: number, incomingEdge: boolean) => (
    <li key={e.id}>
      <button type="button" className="inspector-link" onClick={() => onSelect(otherId)}>
        {incomingEdge ? <ArrowLeft size={13} /> : <ArrowRight size={13} />}
        <span className="inspector-link-title">{title(otherId)}</span>
      </button>
      <button
        type="button"
        className={`inspector-link-label${e.polarity === "negative" ? " negative" : ""}`}
        title="Verbindung bearbeiten"
        onClick={() => onEditEdge(e)}
      >
        {e.polarity === "negative" ? "− " : "+ "}
        {e.label}
      </button>
    </li>
  );

  return (
    <aside className="inspector" aria-label="Details zum Knoten">
      <header className="inspector-head">
        <span className="inspector-kind">
          <Icon size={13} />
          {nodeKindLabel[node.kind]}
        </span>
        <button type="button" className="icon-btn" aria-label="Schließen" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <h2 className="inspector-title">{node.title}</h2>
      {node.text ? <p className="inspector-text">{node.text}</p> : <p className="inspector-text muted">Keine Notiz.</p>}

      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="inspector-section">
          <span className="card-title">Zusammenhänge</span>
          <ul className="inspector-links">
            {incoming.map((e) => link(e, e.from, true))}
            {outgoing.map((e) => link(e, e.to, false))}
          </ul>
        </div>
      )}

      {node.symbol && (
        <div className="inspector-section">
          <span className="card-title">Verknüpft</span>
          <div className="inspector-symbol">
            <span className="tr-badge">{node.symbol}</span>
            <span className="muted">{summary || "Keine Positionen"}</span>
          </div>
          {related.length > 0 && (
            <SecondaryButton className="sm" onClick={() => navigate("trading")}>
              Im Trading öffnen
            </SecondaryButton>
          )}
        </div>
      )}

      <div className="inspector-actions">
        <SecondaryButton onClick={onConnect}>
          <Link2 size={15} />
          Verbinden
        </SecondaryButton>
        <SecondaryButton onClick={onEdit}>
          <Pencil size={15} />
          Bearbeiten
        </SecondaryButton>
      </div>
    </aside>
  );
}

function Workspace({ strategy, trades, onEditStrategy }: { strategy: Strategy; trades: Pick<Trade, "symbol" | "status">[]; onEditStrategy: () => void }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [overrides, setOverrides] = useState<Map<number, Point>>(new Map());
  const [connect, setConnect] = useState<ConnectState | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [deleting, setDeleting] = useState<GraphNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; origin: Point; moved: boolean } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  const pos = useCallback((n: GraphNode): Point => overrides.get(n.id) ?? n, [overrides]);
  const nodeById = useMemo(() => new Map(strategy.nodes.map((n) => [n.id, n])), [strategy.nodes]);
  const selected = selectedId !== null ? nodeById.get(selectedId) ?? null : null;
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol.toUpperCase()))].sort(), [trades]);

  // Eine gespeicherte Position löst die vorläufige beim Ziehen ab
  useEffect(() => {
    setOverrides((m) => {
      if (m.size === 0) return m;
      const next = new Map(m);
      for (const n of strategy.nodes) {
        const o = next.get(n.id);
        if (o && o.x === n.x && o.y === n.y) next.delete(n.id);
      }
      return next.size === m.size ? m : next;
    });
  }, [strategy.nodes]);

  const positions = strategy.nodes.map(pos);
  const width = Math.max(0, ...positions.map((p) => p.x)) + NODE_WIDTH + ROOM;
  const height = Math.max(0, ...positions.map((p) => p.y)) + NODE_HEIGHT + ROOM;

  const edges = strategy.edges.flatMap((e) => {
    const a = nodeById.get(e.from);
    const b = nodeById.get(e.to);
    return a && b ? [{ edge: e, ...edgeGeometry(pos(a), pos(b)) }] : [];
  });
  const touches = (e: GraphEdge) => selected !== null && (e.from === selected.id || e.to === selected.id);

  const toStage = (clientX: number, clientY: number): Point => {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom } : { x: 0, y: 0 };
  };

  // --- Zoom ---------------------------------------------------------------
  const step = (delta: number) => setZoom((z) => clampZoom(z + delta));

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.002));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const fit = () => {
    const el = scrollRef.current;
    if (!el || strategy.nodes.length === 0) return setZoom(1);
    const xs = positions.map((p) => p.x);
    const ys = positions.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const spanX = Math.max(...xs) + NODE_WIDTH - minX;
    const spanY = Math.max(...ys) + NODE_HEIGHT - minY;
    const z = clampZoom(Math.min((el.clientWidth - 120) / spanX, (el.clientHeight - 120) / spanY, 1));
    setZoom(z);
    requestAnimationFrame(() => el.scrollTo({ left: Math.max(0, minX * z - 60), top: Math.max(0, minY * z - 60) }));
  };

  // --- Verbinden ----------------------------------------------------------
  const openEdge = (from: number, to: number) => {
    setConnect(null);
    // Gibt es die Verbindung schon, wird sie bearbeitet statt doppelt angelegt
    const existing = strategy.edges.find((e) => e.from === from && e.to === to);
    setModal(existing ? { kind: "edge", edge: existing } : { kind: "edge", from, to });
  };

  const finishConnect = (target: number) => {
    if (!connect) return;
    if (connect.from === null) return setConnect({ ...connect, from: target });
    if (connect.from === target) return setConnect(null);
    openEdge(connect.from, target);
  };

  const toggleConnect = () => setConnect((c) => (c ? null : { from: selectedId, drag: false, pointer: null }));

  useEffect(() => {
    if (!connect) return;
    const onMove = (e: PointerEvent) => setConnect((c) => (c ? { ...c, pointer: toStage(e.clientX, e.clientY) } : c));
    const onUp = (e: PointerEvent) => {
      if (!connect.drag || connect.from === null) return;
      const id = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]")?.getAttribute("data-node-id");
      const target = id ? Number(id) : null;
      if (target !== null && target !== connect.from) openEdge(connect.from, target);
      else setConnect(null);
    };
    // Escape bricht nur das Verbinden ab, nicht den Dialog dahinter
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setConnect(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
    };
    // toStage und openEdge hängen nur von Zoom und Strategie ab
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect?.from, connect?.drag, zoom, strategy]);

  // --- Knoten ziehen ------------------------------------------------------
  const onNodeDown = (e: ReactPointerEvent<HTMLDivElement>, n: GraphNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (connect && !connect.drag) return finishConnect(n.id);
    setSelectedId(n.id);
    const p = pos(n);
    drag.current = { id: n.id, startX: e.clientX, startY: e.clientY, origin: { x: p.x, y: p.y }, moved: false };
    capture(e);
  };

  const dragTarget = (e: ReactPointerEvent, d: NonNullable<typeof drag.current>): Point => ({
    x: Math.max(0, Math.round(d.origin.x + (e.clientX - d.startX) / zoom)),
    y: Math.max(0, Math.round(d.origin.y + (e.clientY - d.startY) / zoom)),
  });

  const onNodeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
    d.moved = true;
    const p = dragTarget(e, d);
    setOverrides((m) => new Map(m).set(d.id, p));
  };

  const onNodeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    const p = dragTarget(e, d);
    moveNode(d.id, p.x, p.y).catch((err) => {
      setError(String(err));
      setOverrides((m) => {
        const next = new Map(m);
        next.delete(d.id);
        return next;
      });
    });
  };

  // --- Fläche verschieben -------------------------------------------------
  const onBackgroundDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (e.button !== 0) return;
    // Klicks auf die Bildlaufleisten nicht abfangen
    const r = el.getBoundingClientRect();
    if (e.clientX - r.left >= el.clientWidth || e.clientY - r.top >= el.clientHeight) return;
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
    capture(e);
  };

  const onBackgroundMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 3) return;
    p.moved = true;
    e.currentTarget.scrollLeft = p.left - dx;
    e.currentTarget.scrollTop = p.top - dy;
  };

  const onBackgroundUp = () => {
    const p = pan.current;
    pan.current = null;
    if (p && !p.moved) setSelectedId(null);
  };

  // --- Anlegen und Menüs --------------------------------------------------
  const viewCenter = (): Point => {
    const el = scrollRef.current;
    if (!el) return { x: 80, y: 80 };
    return { x: (el.scrollLeft + el.clientWidth / 2) / zoom - NODE_WIDTH / 2, y: (el.scrollTop + el.clientHeight / 2) / zoom - NODE_HEIGHT / 2 };
  };

  const newNode = (at?: Point) =>
    setModal({ kind: "node", position: freeSpot(positions, at ?? (strategy.nodes.length === 0 ? { x: 80, y: 80 } : viewCenter())) });

  const nodeMenu = (e: React.MouseEvent, n: GraphNode) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(n.id);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Bearbeiten", icon: Pencil, onClick: () => setModal({ kind: "node", node: n }) },
        { label: "Verbindung von hier", icon: Link2, onClick: () => setConnect({ from: n.id, drag: false, pointer: null }) },
        { label: "Löschen", icon: Trash2, onClick: () => setDeleting(n) },
      ],
    });
  };

  const backgroundMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = toStage(e.clientX, e.clientY);
    setMenu({ x: e.clientX, y: e.clientY, items: [{ label: "Neuer Knoten hier", icon: Plus, onClick: () => newNode({ x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 }) }] });
  };

  const removeNode = async (n: GraphNode) => {
    setDeleting(null);
    try {
      await deleteNode(n.id);
      setSelectedId(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const preview = connect?.from != null && connect.pointer ? nodeById.get(connect.from) : undefined;
  const previewFrom = preview ? pos(preview) : null;

  return (
    <>
      <header className="strat-head">
        <div className="strat-head-text">
          <div className="strat-title-row">
            <h2 className="strat-title">{strategy.title}</h2>
            <button type="button" className="icon-btn" aria-label="Strategie bearbeiten" title="Umbenennen oder löschen" onClick={onEditStrategy}>
              <Pencil size={14} />
            </button>
          </div>
          <p className="page-subtitle">
            {counts(strategy)} · {formatNoteTime(strategy.updatedAt)}
          </p>
        </div>
        <div className="page-actions">
          <SecondaryButton className={connect ? "active" : ""} disabled={strategy.nodes.length < 2} onClick={toggleConnect}>
            <Link2 size={16} />
            Verbindung
          </SecondaryButton>
          <Button onClick={() => newNode()}>
            <Plus size={16} />
            Neuer Knoten
          </Button>
        </div>
      </header>

      <div className={`graph-wrap${connect ? " connecting" : ""}`}>
        <div
          ref={scrollRef}
          className="graph-scroll"
          onPointerDown={onBackgroundDown}
          onPointerMove={onBackgroundMove}
          onPointerUp={onBackgroundUp}
          onPointerCancel={onBackgroundUp}
          onContextMenu={backgroundMenu}
        >
          <div style={{ width: width * zoom, height: height * zoom }}>
            <div ref={stageRef} className="graph-stage" style={{ width, height, transform: `scale(${zoom})` }}>
              <svg className="graph-edges" width={width} height={height}>
                <defs>
                  {(["positive", "negative"] as const).map((p) => (
                    <marker key={p} id={`arrow-${p}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,1 L10,5 L0,9 Z" className={`graph-arrow ${p}`} />
                    </marker>
                  ))}
                </defs>
                {edges.map(({ edge, d }) => (
                  <path
                    key={edge.id}
                    d={d}
                    fill="none"
                    className={`graph-edge ${edge.polarity}${touches(edge) ? " active" : ""}`}
                    markerEnd={`url(#arrow-${edge.polarity})`}
                  />
                ))}
                {previewFrom && connect?.pointer && (
                  <path
                    className="graph-edge-preview"
                    fill="none"
                    d={`M${previewFrom.x + NODE_WIDTH / 2},${previewFrom.y + NODE_HEIGHT / 2} L${connect.pointer.x},${connect.pointer.y}`}
                  />
                )}
              </svg>

              {edges.map(({ edge, mid }) => (
                <button
                  key={edge.id}
                  type="button"
                  className={`graph-edge-label ${edge.polarity}${touches(edge) ? " active" : ""}`}
                  style={{ left: mid.x, top: mid.y }}
                  title="Verbindung bearbeiten"
                  onPointerDown={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.stopPropagation()}
                  onClick={() => setModal({ kind: "edge", edge })}
                >
                  {`${edge.polarity === "negative" ? "−" : "+"} ${edge.label}`.trim()}
                </button>
              ))}

              {strategy.nodes.map((n) => {
                const Icon = kindIcon[n.kind];
                const p = pos(n);
                return (
                  <div
                    key={n.id}
                    data-node-id={n.id}
                    className={`graph-node${selectedId === n.id ? " selected" : ""}${connect?.from === n.id ? " source" : ""}${overrides.has(n.id) ? " dragging" : ""}`}
                    style={{ left: p.x, top: p.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
                    role="button"
                    tabIndex={0}
                    onPointerDown={(e) => onNodeDown(e, n)}
                    onPointerMove={onNodeMove}
                    onPointerUp={onNodeUp}
                    onPointerCancel={onNodeUp}
                    onDoubleClick={() => setModal({ kind: "node", node: n })}
                    onContextMenu={(e) => nodeMenu(e, n)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setModal({ kind: "node", node: n });
                      if (e.key === "Delete") setDeleting(n);
                    }}
                  >
                    <div className="graph-node-top">
                      <span className="graph-node-kind">
                        <Icon size={12} />
                        {nodeKindLabel[n.kind]}
                      </span>
                      {n.symbol && <span className="graph-node-symbol">{n.symbol}</span>}
                    </div>
                    <div className="graph-node-title">{n.title}</div>
                    <span
                      className="graph-handle"
                      title="Ziehen, um zu verbinden"
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        e.preventDefault();
                        setConnect({ from: n.id, drag: true, pointer: toStage(e.clientX, e.clientY) });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {strategy.nodes.length === 0 && (
          <div className="graph-empty">
            <p>Diese Strategie ist noch leer.</p>
            <p className="muted">Lege Ereignisse, Unternehmen und Annahmen als Knoten an und verbinde sie zu einer Kette.</p>
            <Button onClick={() => newNode()}>
              <Plus size={16} />
              Ersten Knoten anlegen
            </Button>
          </div>
        )}

        {connect && (
          <div className="graph-banner" role="status">
            {connect.from === null ? "Klicke den Ausgangsknoten an" : "Klicke den Zielknoten an"}
            <span className="muted">Esc zum Abbrechen</span>
          </div>
        )}

        {error && (
          <div className="graph-banner error" role="alert">
            {error}
            <button type="button" className="icon-btn" aria-label="Meldung schließen" onClick={() => setError(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        <div className="graph-legend">
          {NODE_KINDS.map((k) => {
            const Icon = kindIcon[k];
            return (
              <span key={k}>
                <Icon size={12} />
                {nodeKindLabel[k]}
              </span>
            );
          })}
        </div>

        <div className="graph-zoom">
          <button type="button" className="icon-btn" aria-label="Verkleinern" onClick={() => step(-0.1)}>
            <ZoomOut size={15} />
          </button>
          <span>{Math.round(zoom * 100)} %</span>
          <button type="button" className="icon-btn" aria-label="Vergrößern" onClick={() => step(0.1)}>
            <ZoomIn size={15} />
          </button>
          <span className="graph-zoom-sep" />
          <button type="button" className="icon-btn" aria-label="Alles anzeigen" title="Alles anzeigen" onClick={fit}>
            <Maximize size={15} />
          </button>
        </div>

        {selected && (
          <Inspector
            node={selected}
            strategy={strategy}
            trades={trades}
            onSelect={setSelectedId}
            onEdit={() => setModal({ kind: "node", node: selected })}
            onConnect={() => setConnect({ from: selected.id, drag: false, pointer: null })}
            onEditEdge={(edge) => setModal({ kind: "edge", edge })}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {modal?.kind === "node" && (
        <NodeModal strategy={strategy} node={modal.node} position={modal.position} symbols={symbols} onCreated={setSelectedId} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "edge" && <EdgeModal strategy={strategy} edge={modal.edge} from={modal.from} to={modal.to} onClose={() => setModal(null)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Knoten löschen?"
          message={(() => {
            const count = strategy.edges.filter((e) => e.from === deleting.id || e.to === deleting.id).length;
            return count === 0
              ? `„${deleting.title}“ wird dauerhaft gelöscht.`
              : `„${deleting.title}“ wird samt ${count} ${count === 1 ? "Verbindung" : "Verbindungen"} dauerhaft gelöscht.`;
          })()}
          onConfirm={() => void removeNode(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

export function StrategiesView() {
  const { strategies, loaded, error } = useStrategies();
  const trades = useTradeRefs();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit"; strategy: Strategy } | null>(null);

  const active = strategies.find((s) => s.id === activeId) ?? strategies[0] ?? null;
  const needle = query.trim().toLowerCase();
  const list = strategies.filter((s) => !needle || s.title.toLowerCase().includes(needle) || s.nodes.some((n) => n.title.toLowerCase().includes(needle)));

  return (
    <div className="strat-layout">
      <section className="strat-list-pane">
        <header className="strat-list-head">
          <div className="page-title-row">
            <h1 className="page-title">Strategien</h1>
            <Button className="sm" onClick={() => setDialog({ kind: "new" })}>
              <Plus size={14} />
              Neu
            </Button>
          </div>
          <label className="input">
            <Search size={14} />
            <input placeholder="Strategien durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        </header>

        <ul className="strat-list">
          {list.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`strat-item${s.id === active?.id ? " active" : ""}`}
                onClick={() => setActiveId(s.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveId(s.id);
                  setDialog({ kind: "edit", strategy: s });
                }}
              >
                <span className="strat-item-title">{s.title}</span>
                <span className="strat-item-meta">
                  <span>{counts(s)}</span>
                  <span>{formatNoteTime(s.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
          {loaded && list.length === 0 && (
            <li className="strat-empty muted">{strategies.length === 0 ? "Noch keine Strategien." : "Keine Strategien gefunden."}</li>
          )}
        </ul>
      </section>

      <section className="strat-main">
        {error && <p className="field-error strat-error">{error}</p>}
        {active ? (
          <Workspace key={active.id} strategy={active} trades={trades} onEditStrategy={() => setDialog({ kind: "edit", strategy: active })} />
        ) : (
          loaded && (
            <div className="strat-blank">
              <h2>Deine erste Strategie</h2>
              <p className="muted">
                Halte fest, warum du einen Trade eingehst: Ereignisse, Annahmen und Marktreaktionen als Knoten, verbunden zu einer Wirkungskette.
              </p>
              <Button onClick={() => setDialog({ kind: "new" })}>
                <Plus size={16} />
                Strategie anlegen
              </Button>
            </div>
          )
        )}
      </section>

      {dialog?.kind === "new" && <StrategyModal onCreated={setActiveId} onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <StrategyModal strategy={dialog.strategy} onClose={() => setDialog(null)} />}
    </div>
  );
}
