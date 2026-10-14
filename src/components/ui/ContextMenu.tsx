import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import "./ContextMenu.css";

export interface ContextMenuItem {
  label: string;
  icon?: ComponentType<{ size?: number }>;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MARGIN = 8;

/** Kleines Kontextmenü an der Mausposition. Schließt bei Klick daneben, Esc, Scrollen oder Resize. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Am Fensterrand umklappen, damit das Menü nie abgeschnitten wird
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const left = x + el.offsetWidth + MARGIN > window.innerWidth ? Math.max(MARGIN, x - el.offsetWidth) : x;
    const top = y + el.offsetHeight + MARGIN > window.innerHeight ? Math.max(MARGIN, y - el.offsetHeight) : y;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="context-menu" style={pos} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map(({ label, icon: Icon, onClick }) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          className="context-menu-item"
          onClick={() => {
            onClose();
            onClick();
          }}
        >
          {Icon && <Icon size={15} />}
          {label}
        </button>
      ))}
    </div>
  );
}
