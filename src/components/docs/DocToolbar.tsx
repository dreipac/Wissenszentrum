import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  CheckSquare,
  ChevronDown,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Table2,
  type LucideIcon,
} from "lucide-react";

interface ToolButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}

function ToolButton({ icon: Icon, label, active, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? " active" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      // mousedown verhindern, damit der Editor seine Textauswahl behält
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon size={15} />
    </button>
  );
}

type Block = "paragraph" | "h1" | "h2" | "h3";

const BLOCKS: { id: Block; label: string }[] = [
  { id: "paragraph", label: "Text" },
  { id: "h1", label: "Überschrift 1" },
  { id: "h2", label: "Überschrift 2" },
  { id: "h3", label: "Überschrift 3" },
];

function applyBlock(editor: Editor, block: Block) {
  const chain = editor.chain().focus();
  if (block === "paragraph") chain.setParagraph().run();
  else chain.setHeading({ level: Number(block[1]) as 1 | 2 | 3 }).run();
}

/** Auswahl der Absatzart (Text, Überschrift 1–3) als Menü im Stil der App. */
function BlockMenu({ editor, current }: { editor: Editor | null; current: Block }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    // Escape schließt nur das Menü
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) return setPos(null);
    const r = trigger.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 6 });
  };

  const label = BLOCKS.find((b) => b.id === current)?.label ?? "Text";

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`block-trigger${pos ? " open" : ""}`}
        aria-label="Absatzart"
        aria-expanded={pos !== null}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        <span>{label}</span>
        <ChevronDown size={13} />
      </button>
      {pos && (
        <div ref={menu} className="suffix-menu block-menu" style={{ left: pos.left, top: pos.top, transformOrigin: "top left" }} role="listbox">
          {BLOCKS.map((b, i) => (
            <button
              key={b.id}
              type="button"
              role="option"
              aria-selected={b.id === current}
              className={`suffix-option block-option ${b.id}${b.id === current ? " selected" : ""}`}
              style={{ animationDelay: `${i * 25}ms` }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (editor) applyBlock(editor, b.id);
                setPos(null);
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const GRID_COLS = 10;
const GRID_ROWS = 8;

/** Tabelle einfügen: Raster zum Wählen der Größe wie in Word, ein Klick legt die Tabelle an. */
function TablePicker({ editor, active }: { editor: Editor | null; active: boolean }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    // Escape schließt nur das Raster
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      close();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) return setPos(null);
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    setHover(null);
    // Rasterbreite etwa 250 px: nicht über den rechten Rand hinaus
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 266)), top: r.bottom + 6 });
  };

  const insert = (rows: number, cols: number) => {
    editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setPos(null);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`icon-btn${active || pos ? " active" : ""}`}
        aria-label="Tabelle einfügen"
        title="Tabelle einfügen"
        aria-expanded={pos !== null}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        <Table2 size={15} />
      </button>
      {pos && (
        <div ref={menu} className="suffix-menu table-picker" style={{ left: pos.left, top: pos.top, transformOrigin: "top left" }} onMouseDown={(e) => e.preventDefault()}>
          <div className="table-picker-label">{hover ? `${hover.cols} × ${hover.rows} Tabelle` : "Tabelle einfügen"}</div>
          <div className="table-picker-grid" role="grid" aria-label="Größe der Tabelle" onMouseLeave={() => setHover(null)}>
            {Array.from({ length: GRID_ROWS }, (_, r) =>
              Array.from({ length: GRID_COLS }, (_, c) => (
                <div
                  key={`${r}-${c}`}
                  role="gridcell"
                  aria-label={`${c + 1} Spalten, ${r + 1} Zeilen`}
                  className={`table-picker-cell${hover && r < hover.rows && c < hover.cols ? " on" : ""}`}
                  onMouseEnter={() => setHover({ rows: r + 1, cols: c + 1 })}
                  onClick={() => insert(r + 1, c + 1)}
                />
              )),
            )}
          </div>
          <div className="table-picker-hint">Mit Kopfzeile</div>
        </div>
      )}
    </>
  );
}

interface DocToolbarProps {
  editor: Editor | null;
  /** Link-Leiste ist offen */
  linkOpen: boolean;
  onLink: () => void;
}

/** Werkzeugleiste des Editors: eine ruhige Zeile wie bei den Notizen, dazu ein Menü für die Absatzart. */
export function DocToolbar({ editor, linkOpen, onLink }: DocToolbarProps) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            block: (e.isActive("heading", { level: 1 }) ? "h1" : e.isActive("heading", { level: 2 }) ? "h2" : e.isActive("heading", { level: 3 }) ? "h3" : "paragraph") as Block,
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            strike: e.isActive("strike"),
            code: e.isActive("code"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            task: e.isActive("taskList"),
            quote: e.isActive("blockquote"),
            codeBlock: e.isActive("codeBlock"),
            link: e.isActive("link"),
            table: e.isActive("table"),
          }
        : null,
  });
  const c = () => editor?.chain().focus();

  return (
    <div className="note-toolbar doc-toolbar">
      <BlockMenu editor={editor} current={s?.block ?? "paragraph"} />
      <span className="note-toolbar-sep" />
      <ToolButton icon={Bold} label="Fett (Strg B)" active={s?.bold} onClick={() => c()?.toggleBold().run()} />
      <ToolButton icon={Italic} label="Kursiv (Strg I)" active={s?.italic} onClick={() => c()?.toggleItalic().run()} />
      <ToolButton icon={Strikethrough} label="Durchgestrichen" active={s?.strike} onClick={() => c()?.toggleStrike().run()} />
      <ToolButton icon={Code} label="Code" active={s?.code} onClick={() => c()?.toggleCode().run()} />
      <span className="note-toolbar-sep" />
      <ToolButton icon={List} label="Liste" active={s?.bullet} onClick={() => c()?.toggleBulletList().run()} />
      <ToolButton icon={ListOrdered} label="Nummerierte Liste" active={s?.ordered} onClick={() => c()?.toggleOrderedList().run()} />
      <ToolButton icon={CheckSquare} label="Checkliste" active={s?.task} onClick={() => c()?.toggleTaskList().run()} />
      <span className="note-toolbar-sep" />
      <ToolButton icon={Quote} label="Zitat" active={s?.quote} onClick={() => c()?.toggleBlockquote().run()} />
      <ToolButton icon={SquareCode} label="Codeblock" active={s?.codeBlock} onClick={() => c()?.toggleCodeBlock().run()} />
      <ToolButton icon={Minus} label="Trennlinie" onClick={() => c()?.setHorizontalRule().run()} />
      <span className="note-toolbar-sep" />
      <ToolButton icon={Link2} label="Link" active={s?.link || linkOpen} onClick={onLink} />
      <TablePicker editor={editor} active={s?.table === true} />
    </div>
  );
}
