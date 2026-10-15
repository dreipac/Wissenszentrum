import { useEffect, useState, type RefObject } from "react";
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

interface Place {
  top: number;
  left: number;
}

interface TableBarProps {
  editor: Editor | null;
  /** Element, an dem die Position gemessen wird (muss `position: relative` haben) */
  anchor: RefObject<HTMLElement | null>;
}

const BAR_HEIGHT = 38;
const GAP = 8;

/** Schwebende Leiste mit den Tabellenoptionen, direkt über der Tabelle, in der der Cursor steht. */
export function TableBar({ editor, anchor }: TableBarProps) {
  const [place, setPlace] = useState<Place | null>(null);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e ? { header: e.isActive("tableHeader"), canMerge: e.can().mergeCells(), canSplit: e.can().splitCell() } : null,
  });

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const root = anchor.current;
      if (!root || !editor.isEditable || !editor.isActive("table")) return setPlace((p) => (p === null ? p : null));
      const { node } = editor.view.domAtPos(editor.state.selection.from);
      const table = (node instanceof Element ? node : node.parentElement)?.closest("table");
      if (!table) return setPlace((p) => (p === null ? p : null));
      const a = root.getBoundingClientRect();
      const t = table.getBoundingClientRect();
      // Über der Tabelle; reicht der Platz nach oben nicht, darunter
      const above = t.top - a.top - BAR_HEIGHT - GAP;
      const next = { top: above >= 0 ? above : t.bottom - a.top + GAP, left: t.left - a.left };
      setPlace((p) => (p && p.top === next.top && p.left === next.left ? p : next));
    };
    update();
    editor.on("transaction", update);
    window.addEventListener("resize", update);
    return () => {
      editor.off("transaction", update);
      window.removeEventListener("resize", update);
    };
  }, [editor, anchor]);

  if (!editor || !place) return null;
  const c = () => editor.chain().focus();

  return (
    <div className="table-bar" style={{ top: place.top, left: place.left }} role="toolbar" aria-label="Tabelle bearbeiten">
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
