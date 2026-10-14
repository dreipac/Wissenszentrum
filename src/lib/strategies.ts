export type NodeKind = "company" | "event" | "assumption" | "reaction" | "risk";

export const nodeKindLabel: Record<NodeKind, string> = {
  company: "Unternehmen",
  event: "Ereignis",
  assumption: "Annahme",
  reaction: "Markt-Reaktion",
  risk: "Risiko",
};

export const NODE_KINDS = Object.keys(nodeKindLabel) as NodeKind[];

export type Polarity = "positive" | "negative";

export interface GraphNode {
  id: number;
  title: string;
  kind: NodeKind;
  text: string;
  /** Verknüpftes Handelssymbol, leer = keines */
  symbol: string;
  /** Position auf der Zeichenfläche (px) */
  x: number;
  y: number;
}

export interface GraphEdge {
  id: number;
  from: number;
  to: number;
  label: string;
  /** positive verstärkt, negative schwächt oder bremst */
  polarity: Polarity;
}

export interface Strategy {
  id: number;
  title: string;
  updatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface NodeInput {
  title: string;
  kind: NodeKind;
  text: string;
  symbol: string;
  x: number;
  y: number;
}

export interface EdgeInput {
  from: number;
  to: number;
  label: string;
  polarity: Polarity;
}

export const NODE_WIDTH = 210;
export const NODE_HEIGHT = 78;

/** Gängige Beschriftungen für Verbindungen (als Vorschlag, frei überschreibbar). */
export const EDGE_LABELS = ["führt zu", "stützt", "erhöht", "verknappt", "treibt", "wirkt auf", "bremst", "belastet"];

export interface Point {
  x: number;
  y: number;
}

/** Verbindungslinie zwischen zwei Knoten: weiche Kurve von Kante zu Kante samt Mittelpunkt für die Beschriftung. */
export function edgeGeometry(a: Point, b: Point): { d: string; mid: Point } {
  const ac = { x: a.x + NODE_WIDTH / 2, y: a.y + NODE_HEIGHT / 2 };
  const bc = { x: b.x + NODE_WIDTH / 2, y: b.y + NODE_HEIGHT / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  let p1: Point, p2: Point, c1: Point, c2: Point;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const s = Math.sign(dx) || 1;
    p1 = { x: ac.x + (s * NODE_WIDTH) / 2, y: ac.y };
    p2 = { x: bc.x - (s * NODE_WIDTH) / 2, y: bc.y };
    const k = Math.max(Math.abs(p2.x - p1.x) / 2, 30);
    c1 = { x: p1.x + s * k, y: p1.y };
    c2 = { x: p2.x - s * k, y: p2.y };
  } else {
    const s = Math.sign(dy) || 1;
    p1 = { x: ac.x, y: ac.y + (s * NODE_HEIGHT) / 2 };
    p2 = { x: bc.x, y: bc.y - (s * NODE_HEIGHT) / 2 };
    const k = Math.max(Math.abs(p2.y - p1.y) / 2, 30);
    c1 = { x: p1.x, y: p1.y + s * k };
    c2 = { x: p2.x, y: p2.y - s * k };
  }

  const mid = {
    x: 0.125 * p1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x,
    y: 0.125 * p1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y,
  };
  return { d: `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`, mid };
}

/** Nächster freier Platz ab `start`: schiebt diagonal weiter, bis kein Knoten überlappt. */
export function freeSpot(nodes: Pick<GraphNode, "x" | "y">[], start: Point): Point {
  const gap = 24;
  const overlaps = (p: Point) =>
    nodes.some((n) => Math.abs(n.x - p.x) < NODE_WIDTH + gap && Math.abs(n.y - p.y) < NODE_HEIGHT + gap);
  let p = { x: Math.max(0, Math.round(start.x)), y: Math.max(0, Math.round(start.y)) };
  for (let i = 0; i < 200 && overlaps(p); i++) p = { x: p.x + 36, y: p.y + 36 };
  return p;
}
