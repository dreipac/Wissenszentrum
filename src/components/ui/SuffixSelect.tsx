import { useEffect, useRef, useState } from "react";
import "./SuffixSelect.css";

interface SuffixSelectProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  ariaLabel: string;
}

interface MenuPosition {
  right: number;
  /** Abstand von oben (Menü unterhalb) bzw. von unten (Menü oberhalb) */
  edge: number;
  up: boolean;
}

const ROW_HEIGHT = 34;

/**
 * Auswahl am rechten Rand eines Eingabefelds (Währung, Einheit), wie im alten Trading-Journal.
 * Das Menü ist fest positioniert, damit es nicht vom scrollenden Dialog abgeschnitten wird.
 */
export function SuffixSelect({ value, options, onChange, ariaLabel }: SuffixSelectProps) {
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    // Escape schließt nur das Menü, nicht den Dialog dahinter
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
    const height = options.length * ROW_HEIGHT + 10;
    const up = r.bottom + height + 16 > window.innerHeight && r.top > height + 16;
    setPos({ right: window.innerWidth - r.right, edge: up ? window.innerHeight - r.top : r.bottom, up });
  };

  return (
    <div className="suffix-select">
      <button
        ref={trigger}
        type="button"
        className={`suffix-trigger${pos ? " open" : ""}`}
        aria-label={ariaLabel}
        aria-expanded={pos !== null}
        onClick={toggle}
      >
        <span>{value}</span>
        <svg className="suffix-arrow" width="9" height="9" viewBox="0 0 10 10" fill="none">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {pos && (
        <div
          ref={menu}
          className={`suffix-menu${pos.up ? " up" : ""}`}
          style={pos.up ? { right: pos.right, bottom: pos.edge + 6 } : { right: pos.right, top: pos.edge + 6 }}
          role="listbox"
        >
          {options.map((opt, i) => (
            <button
              key={opt}
              type="button"
              role="option"
              aria-selected={opt === value}
              className={`suffix-option${opt === value ? " selected" : ""}`}
              style={{ animationDelay: `${i * 25}ms` }}
              onClick={() => {
                onChange(opt);
                setPos(null);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
