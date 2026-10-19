import { TableRow } from "@tiptap/extension-table";
import { Plugin } from "@tiptap/pm/state";

/** So nah (in Pixel) an der unteren Zeilenkante wird der Zeiger zum Doppelpfeil. */
const EDGE = 5;
const MIN_HEIGHT = 28;
const CLASS = "row-resize-cursor";

/**
 * Tabellenzeile mit einstellbarer Höhe: An der unteren Kante einer Zeile lässt sich die Höhe mit der Maus ziehen
 * (die Spaltenbreite übernimmt die Tabellenerweiterung selbst). Die Höhe steht als `style="height: …px"` an der Zeile.
 */
export const SizedTableRow = TableRow.extend({
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
              if (event.button !== 0 || !view.editable || !view.dom.classList.contains(CLASS)) return false;
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
                document.body.classList.remove("table-sizing");
                view.dom.classList.remove(CLASS);
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
