import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { GripVertical } from "lucide-react";
import { applyTableDrop, planTableDrop, type DropPlan } from "./tableMove";

interface TableHandleProps {
  editor: Editor | null;
  /** Element, an dem die Position gemessen wird (muss `position: relative` haben) */
  anchor: RefObject<HTMLElement | null>;
  /** Meldet, ob gerade eine Tabelle verschoben wird (die Tabellenleiste blendet sich dann aus) */
  onMoving: (moving: boolean) => void;
}

const HIDE_DELAY_MS = 450;
/** Erst ab dieser Strecke gilt es als Ziehen */
const START_DISTANCE = 4;
const SCROLL_EDGE = 56;
const SCROLL_SPEED = 14;

interface Ghost {
  /** Oberkante und Größe der mitgezogenen Tabelle, relativ zum Anker */
  top: number;
  left: number;
  width: number;
  height: number;
}

interface Preview {
  ghost: Ghost;
  plan: DropPlan;
  /** Ablagekante und neuer Platz relativ zum Anker */
  lineTop: number;
  roomTop: number | null;
}

/**
 * Griff links oben an einer Tabelle zum Verschieben: Fährt man über eine Tabelle, erscheint er. Beim Ziehen folgt
 * eine Umrisskopie der Maus; eine Linie zeigt, wo die Tabelle landet. Weiter unten im leeren Text entstehen vor der
 * Tabelle leere Zeilen, die als Fläche mit Anzahl angezeigt werden.
 */
export function TableHandle({ editor, anchor, onMoving }: TableHandleProps) {
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const table = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const moving = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    const measure = () => {
      const root = anchor.current;
      const el = table.current;
      if (moving.current) return;
      if (!root || !el || !el.isConnected) return setPlace(null);
      const a = root.getBoundingClientRect();
      const t = el.getBoundingClientRect();
      const next = { top: t.top - a.top, left: t.left - a.left - 30 };
      setPlace((p) => (p && p.top === next.top && p.left === next.left ? p : next));
    };
    const hide = () => {
      if (moving.current) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setPlace(null), HIDE_DELAY_MS);
    };
    const onMove = (e: MouseEvent) => {
      if (!editor.isEditable || moving.current) return;
      const found = (e.target as Element).closest?.("table") as HTMLElement | null;
      if (!found) return hide();
      window.clearTimeout(timer.current);
      table.current = found;
      measure();
    };

    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", hide);
    editor.on("transaction", measure);
    return () => {
      window.clearTimeout(timer.current);
      cleanup.current?.();
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", hide);
      editor.off("transaction", measure);
    };
  }, [editor, anchor]);

  if (!editor) return null;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = table.current;
    const root = anchor.current;
    if (e.button !== 0 || !el || !root) return;
    const { view } = editor;
    // Position der Tabelle im Dokument finden
    const $inside = view.state.doc.resolve(view.posAtDOM(el, 0));
    let from = -1;
    for (let depth = $inside.depth; depth > 0; depth--) {
      if ($inside.node(depth).type.name === "table") {
        from = $inside.before(depth);
        break;
      }
    }
    if (from < 0) return;
    e.preventDefault();

    const grip = e.currentTarget;
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* Zeiger nicht mehr aktiv */
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const box = el.getBoundingClientRect();
    const offsetY = startY - box.top;
    let pointerY = startY;
    let started = false;
    let tick: number | undefined;

    const update = () => {
      const a = root.getBoundingClientRect();
      const top = pointerY - offsetY;
      const plan = planTableDrop(view, from, top);
      if (!plan) return;
      setPreview({
        ghost: { top: top - a.top, left: box.left - a.left, width: box.width, height: box.height },
        plan,
        lineTop: plan.lineY - a.top,
        roomTop: plan.roomTop === null ? null : plan.roomTop - a.top,
      });
    };

    // Am unteren oder oberen Rand des Fensters mitscrollen, damit man weit nach unten ziehen kann
    const scrollBox = view.dom.closest(".docs-scroll");
    const autoScroll = () => {
      if (!scrollBox) return;
      const r = scrollBox.getBoundingClientRect();
      const dy = pointerY > r.bottom - SCROLL_EDGE ? SCROLL_SPEED : pointerY < r.top + SCROLL_EDGE ? -SCROLL_SPEED : 0;
      if (dy !== 0) scrollBox.scrollTop += dy;
      update();
    };

    const finish = (apply: boolean) => {
      window.clearInterval(tick);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      cleanup.current = null;
      if (started) {
        const plan = apply ? planTableDrop(view, from, pointerY - offsetY) : null;
        moving.current = false;
        document.body.classList.remove("table-moving");
        el.classList.remove("table-source");
        setPreview(null);
        setPlace(null);
        onMoving(false);
        if (plan) applyTableDrop(view, from, plan);
      }
    };
    const move = (ev: PointerEvent) => {
      pointerY = ev.clientY;
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < START_DISTANCE) return;
        started = true;
        moving.current = true;
        document.body.classList.add("table-moving");
        el.classList.add("table-source");
        onMoving(true);
        tick = window.setInterval(autoScroll, 40);
      }
      update();
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopImmediatePropagation();
      finish(false);
    };

    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    cleanup.current = () => finish(false);
  };

  return (
    <>
      {place && (
        <div
          className={`table-handle${preview ? " dragging" : ""}`}
          style={{ top: place.top, left: place.left }}
          title="Tabelle verschieben (ziehen)"
          aria-label="Tabelle verschieben"
          onPointerDown={onPointerDown}
          onMouseEnter={() => window.clearTimeout(timer.current)}
          onMouseLeave={() => {
            if (moving.current) return;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setPlace(null), HIDE_DELAY_MS);
          }}
        >
          <GripVertical size={15} />
        </div>
      )}

      {preview && (
        <div className="table-drop" aria-hidden="true">
          {preview.roomTop !== null && (
            <div className="table-drop-room" style={{ top: preview.roomTop, height: Math.max(0, preview.lineTop - preview.roomTop) }}>
              <span>{preview.plan.rooms === 1 ? "1 Zeile Platz zum Schreiben" : `${preview.plan.rooms} Zeilen Platz zum Schreiben`}</span>
            </div>
          )}
          <div className="table-drop-line" style={{ top: preview.lineTop, left: preview.ghost.left, width: preview.ghost.width }} />
          <div
            className="table-drop-ghost"
            style={{ top: preview.ghost.top, left: preview.ghost.left, width: preview.ghost.width, height: preview.ghost.height }}
          />
        </div>
      )}
    </>
  );
}
