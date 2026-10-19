import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { CellSelection, TableMap, selectionCell } from "@tiptap/pm/tables";
import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Merge,
  PanelLeft,
  PanelTop,
  Rows3,
  Split,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";

interface BarButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

function BarButton({ icon: Icon, label, active, disabled, danger, onClick }: BarButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? " active" : ""}${danger ? " danger" : ""}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      // mousedown verhindern, damit der Cursor in der Zelle bleibt
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon size={15} />
    </button>
  );
}

type SelectMode = "row" | "column" | "table";

/** Markiert die Zeile, die Spalte oder alle Zellen der Tabelle, in der der Cursor steht. */
function selectCells(editor: Editor, mode: SelectMode) {
  const { state, view } = editor;
  let $cell;
  try {
    $cell = selectionCell(state);
  } catch {
    return;
  }
  let selection: CellSelection;
  if (mode === "row") selection = CellSelection.rowSelection($cell);
  else if (mode === "column") selection = CellSelection.colSelection($cell);
  else {
    const table = $cell.node(-1);
    const start = $cell.start(-1);
    const map = TableMap.get(table);
    selection = new CellSelection(state.doc.resolve(start + map.map[0]), state.doc.resolve(start + map.map[map.map.length - 1]));
  }
  view.dispatch(state.tr.setSelection(selection));
  view.focus();
}

interface TableBarProps {
  editor: Editor | null;
  /** Element des Editors; daran wird der scrollende Bereich gefunden, in dem die Leiste schwebt */
  anchor: RefObject<HTMLElement | null>;
  /** Ausgeblendet, solange die Tabelle verschoben wird */
  hidden?: boolean;
}

const BAR_HEIGHT = 38;
const GAP = 8;

/**
 * Schwebende Leiste mit den Tabellenoptionen. Sie sitzt über der Tabelle, in der der Cursor steht. Scrollt man den
 * Tabellenkopf aus dem Bild, bleibt sie direkt unter der Werkzeugleiste des Editors stehen, solange man in der Tabelle
 * ist. Die Position wird beim Scrollen direkt am Element gesetzt (ohne Umweg über React), damit nichts nachzieht.
 */
export function TableBar({ editor, anchor, hidden }: TableBarProps) {
  const [active, setActive] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLElement | null>(null);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e ? { header: e.isActive("tableHeader"), canMerge: e.can().mergeCells(), canSplit: e.can().splitCell() } : null,
  });

  /** Setzt die Leiste in Fensterkoordinaten: über die Tabelle, am oberen Rand des scrollenden Bereichs festgehalten. */
  const position = useCallback(() => {
    const el = bar.current;
    const tbl = table.current;
    if (!el || !tbl || !tbl.isConnected) return;
    const scroller = anchor.current?.closest<HTMLElement>(".docs-scroll");
    const view = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
    const t = tbl.getBoundingClientRect();
    const h = el.offsetHeight || BAR_HEIGHT;
    const w = el.offsetWidth;

    const minTop = view.top + GAP;
    const maxTop = t.bottom - h - GAP;
    const top = Math.min(Math.max(t.top - h - GAP, minTop), maxTop);
    // Ganz aus dem Bild gescrollt: Tabelle ist nicht mehr sichtbar, die Leiste darf nicht über die Werkzeugleiste ragen
    const gone = t.bottom < view.top || t.top > view.bottom || maxTop < minTop;
    const left = Math.min(Math.max(t.left, view.left + GAP), Math.max(view.right - w - GAP, view.left + GAP));

    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
    el.style.visibility = gone ? "hidden" : "visible";
  }, [anchor]);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      if (!editor.isEditable || !editor.isActive("table")) {
        table.current = null;
        return setActive(false);
      }
      const { node } = editor.view.domAtPos(editor.state.selection.from);
      const found = (node instanceof Element ? node : node.parentElement)?.closest("table") ?? null;
      table.current = found;
      setActive(found !== null);
      position();
    };
    update();
    editor.on("transaction", update);
    window.addEventListener("resize", position);
    const scroller = anchor.current?.closest<HTMLElement>(".docs-scroll");
    scroller?.addEventListener("scroll", position, { passive: true });
    return () => {
      editor.off("transaction", update);
      window.removeEventListener("resize", position);
      scroller?.removeEventListener("scroll", position);
    };
  }, [editor, anchor, position]);

  // Beim ersten Zeichnen (und nach dem Einblenden) sofort an die richtige Stelle, noch vor dem Malen
  useLayoutEffect(() => {
    if (active && !hidden) position();
  }, [active, hidden, position]);

  if (!editor || !active || hidden) return null;
  const c = () => editor.chain().focus();

  return (
    <div ref={bar} className="table-bar floating" role="toolbar" aria-label="Tabelle bearbeiten">
      <BarButton icon={Rows3} label="Zeile markieren" onClick={() => selectCells(editor, "row")} />
      <BarButton icon={Columns3} label="Spalte markieren" onClick={() => selectCells(editor, "column")} />
      <BarButton icon={Table2} label="Alle Zellen markieren" onClick={() => selectCells(editor, "table")} />
      <span className="table-bar-sep" />
      <BarButton icon={ArrowUpToLine} label="Zeile darüber einfügen" onClick={() => c().addRowBefore().run()} />
      <BarButton icon={ArrowDownToLine} label="Zeile darunter einfügen" onClick={() => c().addRowAfter().run()} />
      <BarButton icon={Trash2} label="Zeile löschen" onClick={() => c().deleteRow().run()} />
      <span className="table-bar-sep" />
      <BarButton icon={ArrowLeftToLine} label="Spalte links einfügen" onClick={() => c().addColumnBefore().run()} />
      <BarButton icon={ArrowRightToLine} label="Spalte rechts einfügen" onClick={() => c().addColumnAfter().run()} />
      <BarButton icon={Trash2} label="Spalte löschen" onClick={() => c().deleteColumn().run()} />
      <span className="table-bar-sep" />
      <BarButton icon={Merge} label="Zellen verbinden" disabled={!s?.canMerge} onClick={() => c().mergeCells().run()} />
      <BarButton icon={Split} label="Zelle teilen" disabled={!s?.canSplit} onClick={() => c().splitCell().run()} />
      <span className="table-bar-sep" />
      <BarButton icon={PanelTop} label="Kopfzeile ein/aus" active={s?.header} onClick={() => c().toggleHeaderRow().run()} />
      <BarButton icon={PanelLeft} label="Kopfspalte ein/aus" onClick={() => c().toggleHeaderColumn().run()} />
      <span className="table-bar-sep" />
      <BarButton icon={Trash2} label="Tabelle entfernen" danger onClick={() => c().deleteTable().run()} />
    </div>
  );
}
