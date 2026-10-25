import { useEffect, useState } from "react";
import { Select } from "../ui/Select";
import { MAX_EVENT_OFFSET, offsetKind, type OffsetKind } from "../../lib/tasks";
import "./EventOffset.css";

interface EventOffsetProps {
  /** Abstand zum Termin in Tagen: negativ = davor, 0 = am Tag, positiv = danach */
  value: number;
  onChange: (offset: number) => void;
  ariaLabel?: string;
}

/** Abstand zu einem Termin: Anzahl Tage und ob davor oder danach – „am Tag selbst“ braucht keine Zahl. */
export function EventOffset({ value, onChange, ariaLabel = "Abstand zum Termin" }: EventOffsetProps) {
  const kind = offsetKind(value);
  const days = Math.abs(value);
  // Die Zahl wird als Text gehalten, damit man sie löschen und neu eintippen kann
  const [text, setText] = useState(String(days));
  useEffect(() => setText((t) => (Number(t) === days ? t : String(days))), [days]);

  const pickKind = (next: OffsetKind) => {
    if (next === "on") return onChange(0);
    const n = Math.max(days, 1);
    onChange(next === "before" ? -n : n);
  };

  const typeDays = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 3);
    setText(digits);
    const n = Math.min(parseInt(digits, 10), MAX_EVENT_OFFSET);
    if (n >= 1) onChange(kind === "after" ? n : -n);
  };

  return (
    <div className="eo" role="group" aria-label={ariaLabel}>
      {kind !== "on" && (
        <input
          className="field-control eo-days"
          inputMode="numeric"
          aria-label="Anzahl Tage"
          value={text}
          onChange={(e) => typeDays(e.target.value)}
          onBlur={() => setText(String(days))}
          onFocus={(e) => e.target.select()}
        />
      )}
      <Select<OffsetKind>
        size="sm"
        className="eo-kind"
        ariaLabel="Davor oder danach"
        value={kind}
        onChange={pickKind}
        options={[
          { value: "before", label: `${days === 1 ? "Tag" : "Tage"} vorher` },
          { value: "on", label: "Am Tag selbst" },
          { value: "after", label: `${days === 1 ? "Tag" : "Tage"} danach` },
        ]}
      />
    </div>
  );
}
