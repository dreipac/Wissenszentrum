import type { Node as PMNode } from "@tiptap/pm/model";
import { TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";

/**
 * Einzelne Trennlinien einer Tabelle verschieben: nicht die ganze Spalte oder Zeile, sondern nur das Stück Linie
 * zwischen zwei benachbarten Zellen. Eine Tabelle ist ein Raster, deshalb wird sie dafür feiner aufgeteilt: Die neue
 * Linie bekommt ihre eigene Rasterlinie, alle anderen Zellen überspannen sie per colspan bzw. rowspan.
 */

const MIN_W = 40;
/** Etwa die Höhe einer einzeiligen Zeile (Zellabstand plus Text): weniger lässt sich ein Stück Linie nicht zusammenschieben */
const MIN_H = 38;
/** So nah (in Pixeln) liegen zwei Zellkanten, um als dieselbe Linie zu gelten */
const SAME = 1.5;
/** So nah muss der Zeiger an der Linie sein */
const NEAR = 6;

interface Cell {
  node: PMNode;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface TableModel {
  tablePos: number;
  table: PMNode;
  cells: Cell[];
}

export interface Segment {
  axis: "x" | "y";
  /** Zelle links bzw. oben und Zelle rechts bzw. unten der Linie */
  a: number;
  b: number;
  /** Lage der Linie in Pixeln, von der Tabelle aus gemessen */
  at: number;
}

/** Fasst nahe beieinanderliegende Werte zu einem zusammen. */
function cluster(values: number[]): number[] {
  const sorted = [...values].sort((p, q) => p - q);
  const out: number[] = [];
  let group: number[] = [];
  for (const v of sorted) {
    if (group.length && v - group[group.length - 1] > SAME) {
      out.push(group.reduce((s, n) => s + n, 0) / group.length);
      group = [];
    }
    group.push(v);
  }
  if (group.length) out.push(group.reduce((s, n) => s + n, 0) / group.length);
  return out;
}

const snap = (list: number[], v: number) => list.reduce((best, n) => (Math.abs(n - v) < Math.abs(best - v) ? n : best), list[0]);

/** Misst alle Zellen der Tabelle, in der `cell` liegt, relativ zur linken oberen Ecke der Tabelle. */
export function measureTable(view: EditorView, cell: HTMLElement): { model: TableModel; tableEl: HTMLElement } | null {
  const tableEl = cell.closest("table");
  if (!tableEl) return null;
  const $in = view.state.doc.resolve(view.posAtDOM(cell, 0));
  let tablePos = -1;
  let table: PMNode | null = null;
  for (let depth = $in.depth; depth > 0; depth--) {
    if ($in.node(depth).type.name === "table") {
      tablePos = $in.before(depth);
      table = $in.node(depth);
      break;
    }
  }
  if (!table || tablePos < 0) return null;

  const t = tableEl.getBoundingClientRect();
  const raw: Cell[] = [];
  let ok = true;
  table.forEach((row, rowOffset) => {
    row.forEach((cellNode, cellOffset) => {
      const dom = view.nodeDOM(tablePos + 1 + rowOffset + 1 + cellOffset);
      if (!(dom instanceof HTMLElement)) return void (ok = false);
      const r = dom.getBoundingClientRect();
      raw.push({ node: cellNode, x0: r.left - t.left, x1: r.right - t.left, y0: r.top - t.top, y1: r.bottom - t.top });
    });
  });
  if (!ok || raw.length === 0) return null;

  // Kanten glätten: dieselbe Linie bekommt in allen Zellen denselben Wert
  const xs = cluster(raw.flatMap((c) => [c.x0, c.x1]));
  const ys = cluster(raw.flatMap((c) => [c.y0, c.y1]));
  const cells = raw.map((c) => ({ node: c.node, x0: snap(xs, c.x0), x1: snap(xs, c.x1), y0: snap(ys, c.y0), y1: snap(ys, c.y1) }));
  return { model: { tablePos, table, cells }, tableEl: tableEl as HTMLElement };
}

const cellAt = (cells: Cell[], x: number, y: number) => cells.findIndex((c) => x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1);
const near = (p: number, q: number) => Math.abs(p - q) <= SAME;

/**
 * Welches Stück Linie liegt am Zeiger? Beide Zellen müssen sich die Kante genau teilen (gleiche Ausdehnung), sonst
 * ließe sich das Stück nicht verschieben, ohne das Raster zu zerreißen.
 */
export function findSegment(model: TableModel, x: number, y: number, axis: "x" | "y"): Segment | null {
  const { cells } = model;
  if (axis === "x") {
    const edges = cells.flatMap((c) => [c.x0, c.x1]);
    const at = edges.reduce((best, e) => (Math.abs(e - x) < Math.abs(best - x) ? e : best), edges[0]);
    if (Math.abs(at - x) > NEAR) return null;
    const a = cellAt(cells, at - 3, y);
    const b = cellAt(cells, at + 3, y);
    if (a < 0 || b < 0 || !near(cells[a].y0, cells[b].y0) || !near(cells[a].y1, cells[b].y1)) return null;
    return { axis, a, b, at };
  }
  const edges = cells.flatMap((c) => [c.y0, c.y1]);
  const at = edges.reduce((best, e) => (Math.abs(e - y) < Math.abs(best - y) ? e : best), edges[0]);
  if (Math.abs(at - y) > NEAR) return null;
  const a = cellAt(cells, x, at - 3);
  const b = cellAt(cells, x, at + 3);
  if (a < 0 || b < 0 || !near(cells[a].x0, cells[b].x0) || !near(cells[a].x1, cells[b].x1)) return null;
  return { axis, a, b, at };
}

/** Verschiebt das Linienstück um `delta` Pixel und liefert die neu aufgebaute Tabelle samt der neuen Lage der Linie. */
export function moveSegment(model: TableModel, seg: Segment, delta: number): { table: PMNode; at: number } | null {
  const cells = model.cells.map((c) => ({ ...c }));
  const A = cells[seg.a];
  const B = cells[seg.b];
  let at: number;
  // Eine neue Linie darf nicht dicht neben einer bestehenden liegen: dazwischen entstünde eine hauchdünne Zeile bzw.
  // Spalte, die der Browser aufbläht. Sie rastet dann an der bestehenden Linie ein.
  const clearOf = (value: number, edges: number[], gap: number) => {
    const closest = edges.reduce((best, e) => (Math.abs(e - value) < Math.abs(best - value) ? e : best), edges[0]);
    return Math.abs(closest - value) < gap ? closest : value;
  };
  if (seg.axis === "x") {
    at = Math.min(Math.max(seg.at + delta, A.x0 + MIN_W), B.x1 - MIN_W);
    at = clearOf(at, model.cells.flatMap((c) => [c.x0, c.x1]), MIN_W);
    A.x1 = at;
    B.x0 = at;
  } else {
    at = Math.min(Math.max(seg.at + delta, A.y0 + MIN_H), B.y1 - MIN_H);
    at = clearOf(at, model.cells.flatMap((c) => [c.y0, c.y1]), MIN_H);
    A.y1 = at;
    B.y0 = at;
  }
  const table = rebuild(model, cells, seg.axis === "y");
  return table ? { table, at } : null;
}

/** Baut aus den Zellrechtecken wieder eine gültige Tabelle (Raster aus allen vorkommenden Linien, Zellen mit col-/rowspan). */
function rebuild(model: TableModel, cells: Cell[], rowsChanged: boolean): PMNode | null {
  const xs = cluster(cells.flatMap((c) => [c.x0, c.x1]));
  const ys = cluster(cells.flatMap((c) => [c.y0, c.y1]));
  if (xs.length < 2 || ys.length < 2) return null;
  const widths = xs.slice(1).map((x, i) => x - xs[i]);
  const heights = ys.slice(1).map((y, i) => y - ys[i]);
  if (widths.some((w) => w < 1) || heights.some((h) => h < 1)) return null;

  const rowType = model.table.child(0).type;
  const rows: PMNode[][] = ys.slice(1).map(() => []);
  const placed = cells.map((c) => ({
    c,
    ci0: xs.indexOf(snap(xs, c.x0)),
    ci1: xs.indexOf(snap(xs, c.x1)),
    ri0: ys.indexOf(snap(ys, c.y0)),
    ri1: ys.indexOf(snap(ys, c.y1)),
  }));
  placed.sort((p, q) => p.ri0 - q.ri0 || p.ci0 - q.ci0);
  for (const { c, ci0, ci1, ri0, ri1 } of placed) {
    if (ci1 <= ci0 || ri1 <= ri0) return null;
    const attrs = { ...c.node.attrs, colspan: ci1 - ci0, rowspan: ri1 - ri0, colwidth: widths.slice(ci0, ci1).map((w) => Math.round(w)) };
    rows[ri0].push(c.node.type.create(attrs, c.node.content, c.node.marks));
  }

  const oldRows = model.table.childCount;
  const rowNodes = rows.map((cellNodes, i) => {
    const old = !rowsChanged && oldRows === rows.length ? model.table.child(i).attrs : model.table.child(0).attrs;
    const attrs = rowsChanged ? { ...old, rowHeight: Math.round(heights[i]) } : old;
    return rowType.create(attrs, cellNodes);
  });
  const next = model.table.type.create(model.table.attrs, rowNodes);
  try {
    if (TableMap.get(next).problems) return null;
  } catch {
    return null;
  }
  return next;
}

/** Zieht ein einzelnes Linienstück mit der Maus. Gibt false zurück, wenn dort kein Stück verschoben werden kann. */
export function startSegmentDrag(view: EditorView, event: MouseEvent, axis: "x" | "y"): boolean {
  const cell = (event.target as Element).closest<HTMLElement>("td, th");
  if (!cell) return false;
  const measured = measureTable(view, cell);
  if (!measured) return false;
  const { model, tableEl } = measured;
  const box = tableEl.getBoundingClientRect();
  const seg = findSegment(model, event.clientX - box.left, event.clientY - box.top, axis);
  if (!seg) return false;
  event.preventDefault();

  const start = axis === "x" ? event.clientX : event.clientY;
  const A = model.cells[seg.a];
  const marker = document.createElement("div");
  marker.className = `table-segment ${axis}`;
  document.body.append(marker);
  document.body.classList.add(axis === "x" ? "table-sizing-col" : "table-sizing");

  /** Das hervorgehobene Stück folgt der Linie (in Fensterkoordinaten der aktuellen Tabelle). */
  const place = (at: number) => {
    const dom = view.nodeDOM(model.tablePos);
    const t = (dom instanceof HTMLElement ? dom.querySelector("table") ?? dom : tableEl).getBoundingClientRect();
    if (axis === "x") {
      Object.assign(marker.style, { left: `${t.left + at - 1.5}px`, top: `${t.top + A.y0}px`, width: "3px", height: `${A.y1 - A.y0}px` });
    } else {
      Object.assign(marker.style, { left: `${t.left + A.x0}px`, top: `${t.top + at - 1.5}px`, width: `${A.x1 - A.x0}px`, height: "3px" });
    }
  };
  place(seg.at);

  const move = (ev: MouseEvent) => {
    const result = moveSegment(model, seg, (axis === "x" ? ev.clientX : ev.clientY) - start);
    if (!result) return;
    const current = view.state.doc.nodeAt(model.tablePos);
    if (!current || current.type.name !== "table") return;
    view.dispatch(view.state.tr.replaceWith(model.tablePos, model.tablePos + current.nodeSize, result.table));
    place(result.at);
  };
  const up = () => {
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("mouseup", up, true);
    marker.remove();
    document.body.classList.remove("table-sizing", "table-sizing-col");
  };
  window.addEventListener("mousemove", move, true);
  window.addEventListener("mouseup", up, true);
  return true;
}
