import { Fragment } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** Höchstens so viele leere Zeilen entstehen beim Verschieben ans Textende. */
const MAX_ROOMS = 40;

export interface DropPlan {
  /** Position im Dokument, vor der die Tabelle eingefügt wird */
  insertAt: number;
  /** Leere Absätze, die oberhalb der Tabelle entstehen (nur beim Ablegen hinter dem letzten Inhalt) */
  rooms: number;
  /** Bildschirmhöhe (Fenster) der Ablagekante: Oberkante der Tabelle nach dem Ablegen */
  lineY: number;
  /** Bildschirmhöhe, ab der der neue Platz beginnt; nur bei rooms > 0 */
  roomTop: number | null;
}

/** Höhe einer leeren Zeile im Text (Zeilenhöhe plus Absatzabstand). */
function lineStep(view: EditorView): number {
  const style = getComputedStyle(view.dom);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const lh = parseFloat(style.lineHeight);
  return (Number.isFinite(lh) ? lh : parseFloat(style.fontSize) * 1.6) + rem * 0.6;
}

/**
 * Wohin kommt die Tabelle, wenn ihre Oberkante auf Bildschirmhöhe `top` liegt? Zwischen zwei Blöcken, oder – weiter
 * unten im leeren Text – hinter dem letzten Inhalt, mit entsprechend vielen leeren Zeilen davor.
 */
export function planTableDrop(view: EditorView, from: number, top: number): DropPlan | null {
  const { doc } = view.state;
  const table = doc.nodeAt(from);
  if (!table) return null;

  const tableRect = (view.nodeDOM(from) as HTMLElement | null)?.getBoundingClientRect();
  const step = lineStep(view);

  // Steht hinter der Tabelle nur noch Leerraum (leere Absätze), liegt sie praktisch am Textende: Weiter nach unten
  // gezogen entstehen leere Zeilen davor, gemessen an der Strecke, die man sie nach unten zieht
  let meaningfulAfter = false;
  doc.forEach((child, offset) => {
    if (offset === from) return;
    const empty = child.type.name === "paragraph" && child.content.size === 0;
    if (!empty && offset > from) meaningfulAfter = true;
  });
  if (tableRect && !meaningfulAfter && top >= tableRect.top - 2) {
    const rooms = Math.min(MAX_ROOMS, Math.max(0, Math.round((top - tableRect.top) / step)));
    return { insertAt: from, rooms, lineY: tableRect.top + rooms * step, roomTop: rooms > 0 ? tableRect.top : null };
  }

  let first: { offset: number; rect: DOMRect } | null = null;
  let last: { end: number; rect: DOMRect } | null = null;
  let found: { offset: number; rect: DOMRect } | null = null;
  doc.forEach((child, offset) => {
    if (offset === from) return;
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const rect = dom.getBoundingClientRect();
    first ??= { offset, rect };
    last = { end: offset + child.nodeSize, rect };
    if (!found && top < rect.top + rect.height / 2) found = { offset, rect };
  });

  if (found) {
    const hit = found as { offset: number; rect: DOMRect };
    return { insertAt: hit.offset, rooms: 0, lineY: hit.rect.top, roomTop: null };
  }
  if (!last) {
    // Die Seite besteht nur aus der Tabelle
    const rect = (view.nodeDOM(from) as HTMLElement | null)?.getBoundingClientRect();
    return { insertAt: from, rooms: 0, lineY: rect?.top ?? top, roomTop: null };
  }

  const tail = last as { end: number; rect: DOMRect };
  const extra = top - tail.rect.bottom;
  const rooms = extra > step * 0.6 ? Math.min(MAX_ROOMS, Math.round(extra / step)) : 0;
  return {
    insertAt: tail.end,
    rooms,
    lineY: tail.rect.bottom + rooms * step,
    roomTop: rooms > 0 ? tail.rect.bottom : null,
  };
}

/** Führt das Verschieben aus; vor die Tabelle kommen bei Bedarf leere Absätze zum Schreiben. */
export function applyTableDrop(view: EditorView, from: number, plan: DropPlan): void {
  const { state } = view;
  const table = state.doc.nodeAt(from);
  if (!table) return;
  const size = table.nodeSize;
  if (plan.rooms === 0 && (plan.insertAt === from || plan.insertAt === from + size)) return;

  const tr = state.tr.delete(from, from + size);
  const at = tr.mapping.map(plan.insertAt);
  const paragraph = state.schema.nodes.paragraph;
  const nodes = [...Array.from({ length: plan.rooms }, () => paragraph.create()), table];
  tr.insert(at, Fragment.from(nodes));
  // Mit Platz: der Cursor steht in der ersten leeren Zeile, bereit zum Schreiben
  if (plan.rooms > 0) tr.setSelection(TextSelection.create(tr.doc, at + 1));
  view.dispatch(tr.scrollIntoView());
  if (plan.rooms > 0) view.focus();
}
