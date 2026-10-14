import type { ReactNode } from "react";
import { toDateTimeStr } from "../../lib/dates";
import { CURRENCIES } from "../../lib/trading";
import { SuffixSelect } from "../ui/SuffixSelect";

/** Eingabe als Zahl lesen; leer oder ungültig = null. */
export function parseNumber(value: string): number | null {
  const n = Number(value.replace(",", "."));
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** Jetzt als Wert für <input type="datetime-local"> (YYYY-MM-DDTHH:MM). */
export const nowInput = () => toDateTimeStr(new Date()).replace(" ", "T");

/** Wert von <input type="datetime-local"> → "YYYY-MM-DD HH:MM". */
export const fromInput = (value: string) => value.replace("T", " ").slice(0, 16);

interface FieldProps {
  label: string;
  id: string;
  children: ReactNode;
  hint?: string;
}

export function Field({ label, id, children, hint }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

/** Währung rechts im Feld: mit `onChange` als Auswahl, sonst als festes Kürzel. */
export function CurrencySuffix({ value, onChange }: { value: string; onChange?: (value: string) => void }) {
  return onChange ? (
    <SuffixSelect value={value} options={CURRENCIES} onChange={onChange} ariaLabel="Währung" />
  ) : (
    <span className="suffix-text">{value}</span>
  );
}

/** Festes Kürzel rechts im Feld (z. B. „Stk.“, „CHF / oz“). */
export const TextSuffix = ({ children }: { children: ReactNode }) => <span className="suffix-text">{children}</span>;

interface NumberFieldProps {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  autoFocus?: boolean;
  /** Auswahl oder Kürzel rechts im Feld, durch einen Trenner abgesetzt */
  suffix?: ReactNode;
}

export function NumberField({ label, id, value, onChange, placeholder, hint, autoFocus, suffix }: NumberFieldProps) {
  const input = (
    <input
      id={id}
      className={suffix ? undefined : "field-control"}
      type="number"
      inputMode="decimal"
      step="any"
      min="0"
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <Field label={label} id={id} hint={hint}>
      {suffix ? (
        <div className="input-suffix">
          {input}
          <span className="input-suffix-divider" />
          {suffix}
        </div>
      ) : (
        input
      )}
    </Field>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div className="segmented tr-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? "active" : ""} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
