import type { EdgeInput, GraphEdge, GraphNode, NodeInput, Polarity, Strategy } from "../strategies";

// Browser-Preview ohne Tauri: dieselben Regeln wie im Backend, aber nur im Speicher.

let strategies: Strategy[] = [];
let nextId = 1;
const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const find = (id: number) => {
  const s = strategies.find((x) => x.id === id);
  if (!s) throw "Strategie nicht gefunden.";
  return s;
};

const findNode = (id: number) => {
  for (const s of strategies) {
    const node = s.nodes.find((n) => n.id === id);
    if (node) return { s, node };
  }
  throw "Knoten nicht gefunden.";
};

const findEdge = (id: number) => {
  for (const s of strategies) {
    const edge = s.edges.find((e) => e.id === id);
    if (edge) return { s, edge };
  }
  throw "Verbindung nicht gefunden.";
};

const cleanTitle = (title: string, what: string) => {
  const t = title.trim();
  if (!t) throw `Bitte gib ${what} ein.`;
  if (t.length > 120) throw "Der Titel darf höchstens 120 Zeichen lang sein.";
  return t;
};

const coord = (v: number) => {
  if (!Number.isFinite(v)) throw "Ungültige Position.";
  return Math.round(Math.min(100_000, Math.max(0, v)));
};

const nodeFields = (input: NodeInput) => ({
  title: cleanTitle(input.title, "einen Titel"),
  kind: input.kind,
  text: input.text.trim(),
  symbol: input.symbol.trim().toUpperCase(),
});

const touch = (s: Strategy) => {
  s.updatedAt = utcNow();
};

const edgeLabel = (label: string, polarity: Polarity) => {
  if (polarity !== "positive" && polarity !== "negative") throw "Unbekannte Wirkung der Verbindung.";
  if (label.trim().length > 60) throw "Die Beschriftung darf höchstens 60 Zeichen lang sein.";
  return label.trim();
};

export const strategiesStore = {
  async list(): Promise<Strategy[]> {
    return [...strategies]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)
      .map((s) => ({ ...s, nodes: s.nodes.map((n) => ({ ...n })), edges: s.edges.map((e) => ({ ...e })) }));
  },
  async create(title: string): Promise<number> {
    const s: Strategy = { id: nextId++, title: cleanTitle(title, "einen Namen"), updatedAt: utcNow(), nodes: [], edges: [] };
    strategies.push(s);
    return s.id;
  },
  async rename(id: number, title: string) {
    const s = find(id);
    s.title = cleanTitle(title, "einen Namen");
    touch(s);
  },
  async remove(id: number) {
    find(id);
    strategies = strategies.filter((s) => s.id !== id);
  },
  async createNode(strategyId: number, input: NodeInput): Promise<GraphNode> {
    const s = find(strategyId);
    const node: GraphNode = { id: nextId++, ...nodeFields(input), x: coord(input.x), y: coord(input.y) };
    s.nodes.push(node);
    touch(s);
    return { ...node };
  },
  async updateNode(id: number, input: NodeInput) {
    const { s, node } = findNode(id);
    Object.assign(node, nodeFields(input));
    touch(s);
  },
  async moveNode(id: number, x: number, y: number) {
    const { s, node } = findNode(id);
    node.x = coord(x);
    node.y = coord(y);
    touch(s);
  },
  async removeNode(id: number) {
    const { s } = findNode(id);
    s.nodes = s.nodes.filter((n) => n.id !== id);
    s.edges = s.edges.filter((e) => e.from !== id && e.to !== id);
    touch(s);
  },
  async createEdge(strategyId: number, input: EdgeInput): Promise<GraphEdge> {
    const s = find(strategyId);
    const label = edgeLabel(input.label, input.polarity);
    if (input.from === input.to) throw "Ein Knoten kann nicht mit sich selbst verbunden werden.";
    if (!s.nodes.some((n) => n.id === input.from) || !s.nodes.some((n) => n.id === input.to)) throw "Die Knoten gehören nicht zu dieser Strategie.";
    if (s.edges.some((e) => e.from === input.from && e.to === input.to)) throw "Diese Verbindung gibt es bereits.";
    const edge: GraphEdge = { id: nextId++, from: input.from, to: input.to, label, polarity: input.polarity };
    s.edges.push(edge);
    touch(s);
    return { ...edge };
  },
  async updateEdge(id: number, label: string, polarity: Polarity) {
    const { s, edge } = findEdge(id);
    edge.label = edgeLabel(label, polarity);
    edge.polarity = polarity;
    touch(s);
  },
  async removeEdge(id: number) {
    const { s } = findEdge(id);
    s.edges = s.edges.filter((e) => e.id !== id);
    touch(s);
  },
};
