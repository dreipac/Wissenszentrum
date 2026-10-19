import { TableRow } from "@tiptap/extension-table";
import { Plugin } from "@tiptap/pm/state";
import { startSegmentDrag } from "./TableDivider";

/** So nah (in Pixel) an der unteren Zeilenkante wird der Zeiger zum Doppelpfeil. */
const EDGE = 5;
const MIN_HEIGHT = 28;
const CLASS = "row-resize-cursor";
/** Zwei Klicks innerhalb dieser Zeit und Strecke gelten als Doppelklick auf eine Linie */
const DOUBLE_MS = 450;
const DOUBLE_PX = 6;

/**
 * Tabellenzeile mit einstellbarer Höhe: An der unteren Kante einer Zeile lässt sich die Höhe mit der Maus ziehen
 * (die Spaltenbreite übernimmt die Tabellenerweiterung selbst). Die Höhe steht als style="height: …px" an der Zeile.
 *
 * Doppelklick auf eine Trennlinie und danach ziehen verschiebt nur das Stück Linie zwischen den beiden Zellen daneben
 * (siehe TableDivider), statt die ganze Spalte oder Zeile.
 */
export const SizedTableRow = TableRow.extend({
  // Vor der Spaltenerweiterung drankommen, damit der Doppelklick auf eine Spaltenlinie hier landet
  priority: 1000,

  addAttributes() {
    return {
      ...this.parent?.(),
      rowHeight: {
        default: null,
        parseHTML: (el) => {
          const h = parseFloat((el as HTMLElement).style.height);
          return Number.isFinite(h) ? Math.round(h) : null;
        },
        renderHTML: (attrs) => (attrs.rowHeight ? { style: `height: ${attrs.rowHeight}px` } : {}),
      },
    };
  },

  addProseMirrorPlugins() {
    const parent = this.parent?.() ?? [];
    let last: { t: number; x: number; y: number } | null = null;
    return [
      ...parent,
      new Plugin({
        props: {
          handleDOMEvents: {
            mousemove: (view, event) => {
              if (!view.editable) return false;
              const cell = (event.target as Element).closest?.("td, th");
              const rect = cell?.getBoundingClientRect();
              const gap = rect ? rect.bottom - event.clientY : Infinity;
              // Beim Spaltenziehen hat der Spaltenzeiger Vorrang
              const near = !!cell && gap >= -1 && gap <= EDGE && !view.dom.classList.contains("resize-cursor");
              view.dom.classList.toggle(CLASS, near);
              return false;
            },
            mouseleave: (view) => {
              view.dom.classList.remove(CLASS);
              return false;
            },
            mousedown: (view, event) => {
              if (event.button !== 0 || !view.editable) return false;
              const onColumnLine = view.dom.classList.contains("resize-cursor");
              const onRowLine = view.dom.classList.contains(CLASS);
              if (!onColumnLine && !onRowLine) {
                last = null;
                return false;
              }

              // Zweiter Klick kurz nach dem ersten auf derselben Linie: nur dieses Stück Linie ziehen
              const now = performance.now();
              const double = last !== null && now - last.t < DOUBLE_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) < DOUBLE_PX;
              last = { t: now, x: event.clientX, y: event.clientY };
              if (double && startSegmentDrag(view, event, onColumnLine ? "x" : "y")) {
                last = null;
                return true;
              }
              if (!onRowLine || onColumnLine) return false;

              const row = (event.target as Element).closest?.("tr") as HTMLElement | null;
              if (!row) return false;
              event.preventDefault();

              // Position der Zeile im Dokument
              const $in = view.state.doc.resolve(view.posAtDOM(row, 0));
              let pos = -1;
              for (let depth = $in.depth; depth > 0; depth--) {
                if ($in.node(depth).type.name === "tableRow") {
                  pos = $in.before(depth);
                  break;
                }
              }
              if (pos < 0) return false;

              const startY = event.clientY;
              const startHeight = row.getBoundingClientRect().height;
              document.body.classList.add("table-sizing");

              // Die Höhe wird laufend ins Dokument geschrieben (der Editor würde eine nur im DOM gesetzte Höhe zurücksetzen);
              // schnelle Folgeänderungen fasst der Verlauf zu einem Schritt zusammen
              const move = (ev: MouseEvent) => {
                const height = Math.round(Math.max(MIN_HEIGHT, startHeight + ev.clientY - startY));
                const node = view.state.doc.nodeAt(pos);
                if (!node || node.type.name !== "tableRow" || node.attrs.rowHeight === height) return;
                view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, rowHeight: height }));
              };
              const up = () => {
                window.removeEventListener("mousemove", move, true);
                window.removeEventListener("mouseup", up, true);
                // Die Zeilenzeiger-Klasse bleibt stehen: ein schneller zweiter Klick auf die Linie startet das Einzelstück
                document.body.classList.remove("table-sizing");
              };
              window.addEventListener("mousemove", move, true);
              window.addEventListener("mouseup", up, true);
              return true;
            },
          },
        },
      }),
    ];
  },
});
