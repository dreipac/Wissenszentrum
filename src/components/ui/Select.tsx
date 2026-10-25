import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./Select.css";

export interface SelectOption<T> {
  value: T;
  label: string;
  /** Leiser Zusatz rechts in der Zeile, z. B. ein Datum */
  hint?: string;
}

interface SelectProps<T extends string | number | null> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  /** Text, solange kein Eintrag gewählt ist */
  placeholder?: string;
  className?: string;
  /** Kleinere Variante für Zeilen mit mehreren Feldern */
  size?: "sm";
}

const MARGIN = 12;
const GAP = 6;
const MAX_HEIGHT = 288;

/**
 * Auswahlfeld im Stil der App (statt des Auswahlfelds des Betriebssystems): gleiche Optik wie die Eingabefelder,
 * das Menü schwebt als Glasfläche darüber bzw. darunter. Bedienbar per Maus und Tastatur
 * (Pfeile, Enter, Esc, Anfangsbuchstabe).
 */
export function Select<T extends string | number | null>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Auswählen",
  className = "",
  size,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });

  const selected = options.find((o) => o.value === value);
  const selectedIndex = options.findIndex((o) => o.value === value);

  const openMenu = () => {
    setActive(Math.max(selectedIndex, 0));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setPos(null);
  };
  const choose = (i: number) => {
    const opt = options[i];
    if (opt) onChange(opt.value);
    close();
    trigger.current?.focus();
  };

  // Lage: unter dem Feld, bei Platzmangel darüber; bei vielen Einträgen scrollt das Menü
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const r = trigger.current.getBoundingClientRect();
    const natural = Math.min(menu.current.scrollHeight, MAX_HEIGHT);
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = natural > below && above > below;
    const maxHeight = Math.max(120, Math.min(MAX_HEIGHT, up ? above : below));
    const height = Math.min(natural, maxHeight);
    const width = Math.max(r.width, 180);
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - width - MARGIN));
    setPos({ left, top: up ? r.top - GAP - height : r.bottom + GAP, width, maxHeight });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Der aktive Eintrag bleibt im sichtbaren Bereich
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, pos]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(i + 1, last));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        // Schließt nur das Menü, nicht den Dialog dahinter
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        close();
        break;
      default:
        // Anfangsbuchstaben tippen springt zum passenden Eintrag
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          const now = Date.now();
          typed.current.text = now - typed.current.at > 700 ? e.key.toLowerCase() : typed.current.text + e.key.toLowerCase();
          typed.current.at = now;
          const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
          if (hit >= 0) setActive(hit);
        }
    }
  };

  return (
    <div className={`sel${size ? ` ${size}` : ""} ${className}`.trim()}>
      <button
        ref={trigger}
        type="button"
        className={`sel-trigger${open ? " open" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={`sel-value${selected ? "" : " placeholder"}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={15} className="sel-arrow" />
      </button>

      {open &&
        createPortal(
          <div
            ref={menu}
            className="sel-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              width: pos?.width,
              maxHeight: pos?.maxHeight ?? MAX_HEIGHT,
              visibility: pos ? "visible" : "hidden",
            }}
            // Der Fokus bleibt auf dem Feld, damit die Tastatur weiter funktioniert
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((opt, i) => (
              <div
                key={String(opt.value)}
                data-index={i}
                role="option"
                aria-selected={opt.value === value}
                className={`sel-option${i === active ? " active" : ""}${opt.value === value ? " selected" : ""}`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => choose(i)}
              >
                <span className="sel-label">{opt.label}</span>
                {opt.hint && <span className="sel-hint">{opt.hint}</span>}
                {opt.value === value && <Check size={14} className="sel-check" />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
