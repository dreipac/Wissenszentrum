import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, formatMonthYear, isSameDay, isSameMonth, monthGrid } from "../../lib/dates";

const WEEKDAYS = ["M", "D", "M", "D", "F", "S", "S"];

interface MiniMonthProps {
  date: Date;
  today: Date;
  onSelect: (d: Date) => void;
}

/** Kleiner Monatskalender zum schnellen Springen. Blättert unabhängig von der Hauptansicht. */
export function MiniMonth({ date, today, onSelect }: MiniMonthProps) {
  const [shown, setShown] = useState(date);

  // Springt die Hauptansicht in einen anderen Monat, folgt der Mini-Kalender.
  useEffect(() => {
    setShown((s) => (isSameMonth(s, date) ? s : date));
  }, [date]);

  return (
    <div className="mini">
      <div className="mini-head">
        <span className="mini-title">{formatMonthYear(shown)}</span>
        <span className="mini-nav">
          <button type="button" className="icon-btn" aria-label="Vorheriger Monat" onClick={() => setShown(addMonths(shown, -1))}>
            <ChevronLeft size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Nächster Monat" onClick={() => setShown(addMonths(shown, 1))}>
            <ChevronRight size={15} />
          </button>
        </span>
      </div>
      <div className="mini-grid">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="mini-wd">
            {w}
          </span>
        ))}
        {monthGrid(shown).map((d) => {
          const cls = [
            "mini-day",
            isSameMonth(d, shown) ? "" : "outside",
            isSameDay(d, today) ? "today" : "",
            isSameDay(d, date) ? "selected" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button key={d.getTime()} type="button" className={cls} onClick={() => onSelect(d)}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
