import { useEffect, useState, type RefObject } from "react";
import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, Trash2 } from "lucide-react";
import type { ImageAlign } from "./DocImage";

interface NodeBarProps {
  editor: Editor | null;
  /** Element, an dem die Position gemessen wird (muss `position: relative` haben) */
  anchor: RefObject<HTMLElement | null>;
}

interface Target {
  kind: "image" | "rule";
  top: number;
  left: number;
  width: number | null;
  align: ImageAlign;
}

const BAR_HEIGHT = 38;
const GAP = 8;

const SIZES: { label: string; width: number | null }[] = [
  { label: "Klein", width: 240 },
  { label: "Mittel", width: 420 },
  { label: "Groß", width: 640 },
  { label: "Volle Breite", width: null },
];

/**
 * Leiste für ein angeklicktes Bild oder eine Trennlinie: Größe, Ausrichtung und Löschen.
 * Erscheint direkt über dem Element.
 */
export function NodeBar({ editor, anchor }: NodeBarProps) {
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const root = anchor.current;
      const sel = editor.state.selection;
      if (!root || !editor.isEditable || !(sel instanceof NodeSelection)) return setTarget(null);
      const name = sel.node.type.name;
      if (name !== "docImage" && name !== "horizontalRule") return setTarget(null);
      const dom = editor.view.nodeDOM(sel.from);
      if (!(dom instanceof HTMLElement)) return setTarget(null);
      const rect = (dom.querySelector(".doc-image-frame") ?? dom).getBoundingClientRect();
      const a = root.getBoundingClientRect();
      const above = rect.top - a.top - BAR_HEIGHT - GAP;
      const next: Target = {
        kind: name === "docImage" ? "image" : "rule",
        top: above >= 0 ? above : rect.bottom - a.top + GAP,
        left: Math.max(0, rect.left - a.left),
        width: (sel.node.attrs.width as number | null) ?? null,
        align: (sel.node.attrs.align as ImageAlign) ?? "left",
      };
      setTarget((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.align === next.align && prev.kind === next.kind ? prev : next));
    };
    update();
    editor.on("transaction", update);
    window.addEventListener("resize", update);
    return () => {
      editor.off("transaction", update);
      window.removeEventListener("resize", update);
    };
  }, [editor, anchor]);

  if (!editor || !target) return null;

  const set = (attrs: Record<string, unknown>) => editor.chain().focus().updateAttributes("docImage", attrs).run();
  const remove = () => editor.chain().focus().deleteSelection().run();

  return (
    <div className="table-bar node-bar" style={{ top: target.top, left: target.left }} role="toolbar" aria-label={target.kind === "image" ? "Bild bearbeiten" : "Trennlinie bearbeiten"} onMouseDown={(e) => e.preventDefault()}>
      {target.kind === "image" && (
        <>
          {SIZES.map((s) => (
            <button key={s.label} type="button" className={`bar-chip${target.width === s.width ? " active" : ""}`} onClick={() => set({ width: s.width })}>
              {s.label}
            </button>
          ))}
          <span className="table-bar-sep" />
          {(
            [
              ["left", "Links", AlignLeft],
              ["center", "Zentriert", AlignCenter],
              ["right", "Rechts", AlignRight],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} type="button" className={`icon-btn${target.align === id ? " active" : ""}`} aria-label={label} title={label} onClick={() => set({ align: id })}>
              <Icon size={15} />
            </button>
          ))}
          <span className="table-bar-sep" />
        </>
      )}
      <button type="button" className="icon-btn danger" aria-label={target.kind === "image" ? "Bild entfernen" : "Trennlinie entfernen"} title="Entfernen (Entf)" onClick={remove}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}
