import { blocksToHtml, blocksToPlain, type DocNodeSpec } from "../docBlocks";
import { MAX_DEPTH, buildTree, descendantIds, subtreeHeight, type DocInput, type DocKind, type DocNode, type DocPage } from "../docs";

// Browser-Preview ohne Tauri: dieselben Regeln wie im Backend, aber nur im Speicher.

let pages: DocPage[] = [];
let nextId = 1;
const utcNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const find = (id: number) => {
  const page = pages.find((p) => p.id === id);
  if (!page) throw "Seite nicht gefunden.";
  return page;
};

const cleanTitle = (title: string) => {
  const t = title.trim();
  if (t.length > 200) throw "Der Titel darf höchstens 200 Zeichen lang sein.";
  return t;
};

const siblings = (parentId: number | null) => pages.filter((p) => p.parentId === parentId).sort((a, b) => a.position - b.position || a.id - b.id);

const renumber = (parentId: number | null) => siblings(parentId).forEach((p, i) => (p.position = i));

const depthOf = (id: number) => {
  let depth = 1;
  let current = find(id).parentId;
  while (current !== null) {
    depth++;
    current = find(current).parentId;
  }
  return depth;
};

const nodeOf = (id: number): DocNode => buildTree(pages).flatMap(function walk(n): DocNode[] {
  return n.page.id === id ? [n] : n.children.flatMap(walk);
})[0];

export const docsStore = {
  async list(): Promise<DocPage[]> {
    return pages.map((p) => ({ ...p }));
  },
  async create(parentId: number | null, title: string, kind: DocKind): Promise<DocPage> {
    if (kind !== "page" && kind !== "folder") throw "Unbekannte Art des Eintrags.";
    const clean = cleanTitle(title);
    if (parentId !== null && depthOf(parentId) >= MAX_DEPTH) throw `Seiten können höchstens ${MAX_DEPTH} Ebenen tief verschachtelt werden.`;
    if (parentId !== null) find(parentId);
    const now = utcNow();
    const page: DocPage = {
      id: nextId++,
      kind,
      parentId,
      title: clean,
      content: "",
      plain: "",
      position: siblings(parentId).length,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    pages.push(page);
    return { ...page };
  },
  /** Wie im Backend: ein Baum aus Ordnern und Seiten samt Inhalt. */
  async createTree(parentId: number | null, nodes: DocNodeSpec[]): Promise<number[]> {
    const make = async (parent: number | null, node: DocNodeSpec): Promise<number> => {
      const page = await docsStore.create(parent, node.title, node.type);
      if (node.type === "page" && node.blocks.length > 0) {
        await docsStore.update(page.id, { title: node.title, content: blocksToHtml(node.blocks), plain: blocksToPlain(node.blocks) });
      }
      for (const child of node.children) await make(page.id, child);
      return page.id;
    };
    const ids: number[] = [];
    for (const node of nodes) ids.push(await make(parentId, node));
    return ids;
  },
  async update(id: number, input: DocInput): Promise<DocPage> {
    const page = find(id);
    Object.assign(page, { title: cleanTitle(input.title), content: input.content, plain: input.plain, updatedAt: utcNow() });
    return { ...page };
  },
  async setFavorite(id: number, favorite: boolean) {
    find(id).favorite = favorite;
  },
  async move(id: number, parentId: number | null) {
    const page = find(id);
    if (page.parentId === parentId) return;
    if (parentId !== null) {
      if (parentId === id || descendantIds(pages, id).includes(parentId)) throw "Eine Seite kann nicht unter sich selbst oder ihren Unterseiten liegen.";
      if (depthOf(parentId) + subtreeHeight(nodeOf(id)) > MAX_DEPTH) throw `Seiten können höchstens ${MAX_DEPTH} Ebenen tief verschachtelt werden.`;
    }
    const old = page.parentId;
    page.parentId = parentId;
    page.position = siblings(parentId).length;
    renumber(old);
  },
  async place(id: number, parentId: number | null, index: number) {
    const page = find(id);
    if (page.parentId !== parentId && parentId !== null) {
      if (parentId === id || descendantIds(pages, id).includes(parentId)) throw "Eine Seite kann nicht unter sich selbst oder ihren Unterseiten liegen.";
      if (depthOf(parentId) + subtreeHeight(nodeOf(id)) > MAX_DEPTH) throw `Seiten können höchstens ${MAX_DEPTH} Ebenen tief verschachtelt werden.`;
    }
    const old = page.parentId;
    const list = siblings(parentId).filter((p) => p.id !== id);
    list.splice(Math.min(Math.max(index, 0), list.length), 0, page);
    page.parentId = parentId;
    list.forEach((p, i) => (p.position = i));
    if (old !== parentId) renumber(old);
  },
  async shift(id: number, delta: number) {
    const page = find(id);
    const list = siblings(page.parentId);
    const index = list.findIndex((p) => p.id === id);
    const target = index + Math.sign(delta);
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    list.forEach((p, i) => (p.position = i));
  },
  async remove(id: number): Promise<number> {
    const page = find(id);
    const doomed = new Set([id, ...descendantIds(pages, id)]);
    pages = pages.filter((p) => !doomed.has(p.id));
    renumber(page.parentId);
    return doomed.size;
  },
};
