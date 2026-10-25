import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, formatMonthYear, isoWeek, monthGrid, parseDateTime, startOfDay, toDateStr } from "../../lib/dates";
import "./DatePicker.css";

interface DatePickerProps {
  /** Datum als `YYYY-MM-DD`, leer = keines */
  value: string;
  onChange: (value: string) => void;
  /** Frühestes und spätestes wählbares Datum (`YYYY-MM-DD`) */
  min?: string;
  max?: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** Zusätzliche Klasse für den Rahmen (Breite) */
  className?: string;
  autoFocus?: boolean;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat("de-CH", { month: "short" }).format(new Date(2026, i, 1)).replace(".", ""));
const POP_WIDTH = 308;
const MARGIN = 8;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → Datum (nur gültige Kalendertage), sonst null. */
function fromIso(value: string): Date | null {
  const m = ISO.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return toDateStr(d) === value ? d : null;
}

/** `22.10.2026` */
function show(value: string): string {
  const d = fromIso(value);
  return d ? `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}` : "";
}

/** Tippt jemand ein Datum: `22.10.2026`, `22.10.26`, `2026-10-22` → `YYYY-MM-DD`, sonst null. */
function parseTyped(text: string): string | null {
  const t = text.trim();
  if (!t) return "";
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = new Date(year, Number(m[2]) - 1, Number(m[1]));
    return d.getFullYear() === year && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[1]) ? toDateStr(d) : null;
  }
  m = ISO.exec(t);
  return m && fromIso(t) ? t : null;
}

/**
 * Datumsauswahl im Stil der App: Eingabefeld zum Tippen (22.10.2026) plus Kalender mit Kalenderwochen. Ersetzt das
 * Datumsfeld des Browsers. Pfeiltasten wählen den Tag, Enter übernimmt, Esc schließt.
 */
export function DatePicker({ value, onChange, min, max, id, ariaLabel, placeholder = "TT.MM.JJJJ", className = "", autoFocus }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(show(value));
  const [typing, setTyping] = useState(false);
  const [view, setView] = useState<"days" | "months">("days");
  const [shown, setShown] = useState<Date>(() => fromIso(value) ?? startOfDay(new Date()));
  const [kbd, setKbd] = useState<Date | null>(null);
  // Richtung des letzten Monatswechsels: der Inhalt gleitet von dort herein; beim Öffnen gleitet nichts
  const [slide, setSlide] = useState<"next" | "prev" | "none">("none");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  // Von außen geänderter Wert (Schnellauswahl, anderes Feld) erscheint im Feld
  useEffect(() => {
    if (!typing) setText(show(value));
  }, [value, typing]);

  const selected = fromIso(value);
  const today = startOfDay(new Date());
  const outOfRange = (d: Date) => {
    const s = toDateStr(d);
    return (min !== undefined && min !== "" && s < min) || (max !== undefined && max !== "" && s > max);
  };

  /** Anderen Monat (oder anderes Jahr) zeigen und dabei die Richtung für die Animation merken. */
  const go = (target: Date) => {
    const from = shown.getFullYear() * 12 + shown.getMonth();
    const to = target.getFullYear() * 12 + target.getMonth();
    if (to !== from) setSlide(to > from ? "next" : "prev");
    setShown(target);
  };

  const openPopup = () => {
    if (open) return;
    setSlide("none");
    setShown(fromIso(value) ?? startOfDay(new Date()));
    setView("days");
    setKbd(null);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setKbd(null);
  };

  const choose = (d: Date | null) => {
    onChange(d ? toDateStr(d) : "");
    setTyping(false);
    setText(d ? show(toDateStr(d)) : "");
    close();
    input.current?.focus();
  };

  /** Getipptes Datum übernehmen; Ungültiges springt auf den letzten Wert zurück. */
  const commitText = () => {
    setTyping(false);
    const parsed = parseTyped(text);
    if (parsed === null || (parsed !== "" && outOfRange(fromIso(parsed)!))) return setText(show(value));
    if (parsed !== value) onChange(parsed);
    setText(show(parsed));
  };

  // Lage: unter dem Feld, bei Platzmangel darüber
  useLayoutEffect(() => {
    if (!open || !wrap.current || !pop.current) return;
    const r = wrap.current.getBoundingClientRect();
    const h = pop.current.offsetHeight;
    const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - POP_WIDTH - MARGIN));
    const below = r.bottom + 6;
    const top = below + h + MARGIN > window.innerHeight ? Math.max(MARGIN, r.top - h - 6) : below;
    setPos({ left, top });
  }, [open, view, shown]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !wrap.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => {
      if (!pop.current?.contains(e.target as Node)) close();
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

  const move = (d: Date) => {
    setKbd(d);
    go(d);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      return close();
    }
    if (e.key === "ArrowDown" && !open) {
      e.preventDefault();
      return openPopup();
    }
    if (e.key === "Enter") {
      if (open && kbd) {
        e.preventDefault();
        return outOfRange(kbd) ? undefined : choose(kbd);
      }
      commitText();
      return close();
    }
    if (!open || typing || view !== "days") return;
    const base = kbd ?? selected ?? today;
    const steps: Record<string, Date> = {
      ArrowLeft: addDays(base, -1),
      ArrowRight: addDays(base, 1),
      ArrowUp: addDays(base, -7),
      ArrowDown: addDays(base, 7),
      PageUp: addMonths(base, -1),
      PageDown: addMonths(base, 1),
    };
    if (steps[e.key]) {
      e.preventDefault();
      move(steps[e.key]);
    }
  };

  const weeks = useMemo(() => {
    const days = monthGrid(shown);
    return Array.from({ length: 6 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  }, [shown]);

  return (
    <div ref={wrap} className={`dp ${className}`}>
      <input
        ref={input}
        id={id}
        className="field-control dp-input"
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        inputMode="numeric"
        onFocus={openPopup}
        onClick={openPopup}
        onChange={(e) => {
          setText(e.target.value);
          setTyping(true);
        }}
        onBlur={commitText}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="dp-toggle"
        aria-label="Kalender öffnen"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? close() : (input.current?.focus(), openPopup()))}
      >
        <CalendarDays size={15} />
      </button>

      {open &&
        createPortal(
          <div
            ref={pop}
            className="dp-pop"
            role="dialog"
            aria-label="Datum wählen"
            style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: POP_WIDTH, visibility: pos ? "visible" : "hidden" }}
            // Der Fokus bleibt im Feld, damit Tippen und Pfeiltasten weiter gehen
            onMouseDown={(e) => e.preventDefault()}
          >
            <header className="dp-head">
              <button type="button" className="dp-title" onClick={() => setView(view === "days" ? "months" : "days")} aria-label="Monat oder Jahr wählen">
                <span key={`${view}-${shown.getFullYear()}-${view === "days" ? shown.getMonth() : 0}`} className={`dp-title-text ${slide}`}>
                  {view === "days" ? formatMonthYear(shown) : shown.getFullYear()}
                </span>
              </button>
              <span className="dp-nav">
                <button type="button" className="dp-arrow" aria-label={view === "days" ? "Vorheriger Monat" : "Vorheriges Jahr"} onClick={() => go(addMonths(shown, view === "days" ? -1 : -12))}>
                  <ChevronLeft size={16} />
                </button>
                <button type="button" className="dp-arrow" aria-label={view === "days" ? "Nächster Monat" : "Nächstes Jahr"} onClick={() => go(addMonths(shown, view === "days" ? 1 : 12))}>
                  <ChevronRight size={16} />
                </button>
              </span>
            </header>

            <div className="dp-viewport">
            {view === "days" ? (
              <div key={`d-${shown.getFullYear()}-${shown.getMonth()}`} className={`dp-grid ${slide}`} role="grid">
                <span className="dp-kw-head">KW</span>
                {WEEKDAYS.map((d) => (
                  <span key={d} className="dp-weekday">
                    {d}
                  </span>
                ))}
                {weeks.map((week) => (
                  <div key={week[0].getTime()} className="dp-week" role="row">
                    <span className="dp-kw" title={`Kalenderwoche ${isoWeek(week[0])}`}>
                      {isoWeek(week[0])}
                    </span>
                    {week.map((d) => {
                      const iso = toDateStr(d);
                      const other = d.getMonth() !== shown.getMonth();
                      const off = outOfRange(d);
                      const cls = [
                        "dp-day",
                        other ? "other" : "",
                        d.getDay() === 0 || d.getDay() === 6 ? "weekend" : "",
                        iso === toDateStr(today) ? "today" : "",
                        selected && iso === toDateStr(selected) ? "selected" : "",
                        kbd && iso === toDateStr(kbd) ? "focus" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <button key={iso} type="button" className={cls} disabled={off} role="gridcell" aria-selected={selected ? iso === toDateStr(selected) : false} onClick={() => choose(d)}>
                          {d.getDate()}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div key={`m-${shown.getFullYear()}`} className={`dp-months ${slide}`}>
                {MONTHS.map((name, i) => {
                  const current = shown.getMonth() === i;
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`dp-month${current ? " selected" : ""}${today.getFullYear() === shown.getFullYear() && today.getMonth() === i ? " today" : ""}`}
                      onClick={() => {
                        go(new Date(shown.getFullYear(), i, 1));
                        setView("days");
                      }}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            )}
            </div>

            <footer className="dp-foot">
              <button type="button" className="dp-link" onClick={() => choose(null)}>
                Löschen
              </button>
              <button type="button" className="dp-link strong" disabled={outOfRange(today)} onClick={() => choose(today)}>
                Heute
              </button>
            </footer>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Datum und Uhrzeit nebeneinander. Wert im Format `YYYY-MM-DDTHH:MM` (wie `datetime-local`). */
export function DateTimeField({ value, onChange, id, ariaLabel }: { value: string; onChange: (value: string) => void; id?: string; ariaLabel?: string }) {
  const [date = "", time = ""] = value.split("T");
  const fallback = () => parseDateTime(`${date || toDateStr(new Date())} 00:00`);
  return (
    <div className="dtf">
      <DatePicker id={id} ariaLabel={ariaLabel ? `${ariaLabel} Datum` : "Datum"} value={date} onChange={(d) => onChange(d ? `${d}T${time || "09:00"}` : "")} />
      <input
        type="time"
        className="field-control dtf-time"
        aria-label={ariaLabel ? `${ariaLabel} Uhrzeit` : "Uhrzeit"}
        value={time}
        disabled={!date}
        onChange={(e) => onChange(`${date || toDateStr(fallback())}T${e.target.value}`)}
      />
    </div>
  );
}
