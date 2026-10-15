export type DocKind = "page" | "folder";

export interface DocPage {
  id: number;
  /** Seite mit Text oder Ordner zum Ordnen */
  kind: DocKind;
  parentId: number | null;
  title: string;
  /** HTML des Editors */
  content: string;
  /** Derselbe Inhalt als reiner Text (Suche, Leer-Erkennung) */
  plain: string;
  position: number;
  favorite: boolean;
  /** UTC, `YYYY-MM-DD HH:MM:SS` */
  createdAt: string;
  updatedAt: string;
}

export interface DocInput {
  title: string;
  content: string;
  plain: string;
}

export interface DocNode {
  page: DocPage;
  children: DocNode[];
}

/** Höchste Verschachtelungstiefe, wie im Backend. */
export const MAX_DEPTH = 8;

export const pageTitle = (p: Pick<DocPage, "title" | "kind">) => p.title.trim() || (p.kind === "folder" ? "Unbenannter Ordner" : "Unbenannte Seite");

export const isFolder = (p: Pick<DocPage, "kind">) => p.kind === "folder";

export const isEmptyPage = (p: Pick<DocPage, "plain">) => p.plain.trim() === "";

const byOrder = (a: DocPage, b: DocPage) => a.position - b.position || a.id - b.id;

/** Baut aus der flachen Liste den Seitenbaum (Reihenfolge je Ebene nach `position`). */
export function buildTree(pages: DocPage[]): DocNode[] {
  const ids = new Set(pages.map((p) => p.id));
  const children = new Map<number | null, DocPage[]>();
  for (const p of [...pages].sort(byOrder)) {
    // Verwaiste Seiten (Elternteil fehlt) landen auf der Hauptebene
    const key = p.parentId !== null && ids.has(p.parentId) ? p.parentId : null;
    const list = children.get(key) ?? [];
    list.push(p);
    children.set(key, list);
  }
  const make = (p: DocPage): DocNode => ({ page: p, children: (children.get(p.id) ?? []).map(make) });
  return (children.get(null) ?? []).map(make);
}

/** Vorfahren von der Hauptebene bis zum direkten Elternteil (ohne die Seite selbst). */
export function ancestors(pages: DocPage[], id: number): DocPage[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const chain: DocPage[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current !== null && chain.length <= MAX_DEPTH) {
    const parent = byId.get(current);
    if (!parent) break;
    chain.unshift(parent);
    current = parent.parentId;
  }
  return chain;
}

/** IDs aller Seiten unterhalb der Seite (ohne sie selbst). */
export function descendantIds(pages: DocPage[], id: number): number[] {
  const result: number[] = [];
  const queue = [id];
  while (queue.length) {
    const parent = queue.shift()!;
    for (const p of pages) {
      if (p.parentId === parent) {
        result.push(p.id);
        queue.push(p.id);
      }
    }
  }
  return result;
}

/** Höhe des Teilbaums ab dieser Seite (die Seite selbst = 1). */
export function subtreeHeight(node: DocNode): number {
  return 1 + Math.max(0, ...node.children.map(subtreeHeight));
}

export interface ParentOption {
  /** null = Hauptebene */
  id: number | null;
  label: string;
  depth: number;
}

/** Mögliche neue Elternseiten, eingerückt nach Ebene. Die Seite selbst und ihre Unterseiten fehlen. */
export function parentOptions(tree: DocNode[], excludeId: number | null = null): ParentOption[] {
  const options: ParentOption[] = [{ id: null, label: "Hauptebene", depth: 0 }];
  const walk = (nodes: DocNode[], depth: number) => {
    for (const n of nodes) {
      if (n.page.id === excludeId) continue;
      options.push({ id: n.page.id, label: pageTitle(n.page), depth });
      walk(n.children, depth + 1);
    }
  };
  walk(tree, 1);
  return options;
}

export interface SearchHit {
  page: DocPage;
  /** Textstelle rund um den Treffer, leer bei reinem Titeltreffer */
  snippet: string;
}

/** Sucht in Titel und Text. Titeltreffer stehen vor reinen Textreffern. */
export function searchPages(pages: DocPage[], query: string): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const titleHits: SearchHit[] = [];
  const textHits: SearchHit[] = [];
  for (const page of pages) {
    const inTitle = page.title.toLowerCase().includes(needle);
    const text = page.plain.replace(/\s+/g, " ");
    const at = text.toLowerCase().indexOf(needle);
    let snippet = "";
    if (at >= 0) {
      let start = Math.max(0, at - 40);
      // Nicht mitten im Wort beginnen
      if (start > 0) {
        const space = text.indexOf(" ", start);
        if (space >= 0 && space < at) start = space + 1;
      }
      snippet = `${start > 0 ? "… " : ""}${text.slice(start, at + needle.length + 70).trim()}${at + needle.length + 70 < text.length ? " …" : ""}`;
    }
    if (inTitle) titleHits.push({ page, snippet });
    else if (at >= 0) textHits.push({ page, snippet });
  }
  return [...titleHits, ...textHits];
}
