import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DateTimeField } from "../ui/DatePicker";
import { addCashMovement, deleteCashMovement } from "../../lib/api/trading";
import { formatMoney } from "../../lib/format";
import type { CashMovement } from "../../lib/trading";
import { Field, NumberField, Segmented, TextSuffix, fromInput, nowInput, parseNumber } from "./fields";
import "./TradingModals.css";

interface CashModalProps {
  cash: number;
  movements: CashMovement[];
  onClose: () => void;
}

export function CashModal({ cash, movements, onClose }: CashModalProps) {
  const [kind, setKind] = useState<"deposit" | "withdrawal">("deposit");
  const [amount, setAmount] = useState("");
  const [at, setAt] = useState(nowInput);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<CashMovement | null>(null);

  const value = parseNumber(amount);
  const after = value === null ? cash : cash + (kind === "deposit" ? value : -value);

  const save = async () => {
    if (value === null || value <= 0) return setError("Bitte gib einen Betrag größer als 0 ein.");
    setBusy(true);
    setError(null);
    try {
      await addCashMovement(kind, value, note, fromInput(at));
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const remove = async (m: CashMovement) => {
    setDeleting(null);
    try {
      await deleteCashMovement(m.id);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Modal
      title="Guthaben"
      width={520}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <Button disabled={busy} onClick={() => void save()}>
            {kind === "deposit" ? "Einzahlen" : "Auszahlen"}
          </Button>
        </>
      }
    >
      <Segmented
        label="Art"
        value={kind}
        onChange={setKind}
        options={[
          { id: "deposit", label: "Einzahlung" },
          { id: "withdrawal", label: "Auszahlung" },
        ]}
      />

      <div className="tm2-grid">
        <NumberField label="Betrag" id="cash-amount" value={amount} onChange={setAmount} placeholder="z. B. 5000" autoFocus suffix={<TextSuffix>CHF</TextSuffix>} />
        <div className="full">
          <Field label="Zeitpunkt" id="cash-at">
            <DateTimeField id="cash-at" ariaLabel="Zeitpunkt" value={at} onChange={setAt} />
          </Field>
        </div>
        <div className="full">
          <Field label="Notiz (optional)" id="cash-note">
            <input id="cash-note" className="field-control" value={note} placeholder="z. B. Startkapital" onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="tm2-summary">
        <div>
          <span>Guthaben jetzt</span>
          <strong>{formatMoney(cash)}</strong>
        </div>
        <div className={after < 0 ? "warn" : ""}>
          <span>Guthaben danach</span>
          <strong>{formatMoney(after)}</strong>
        </div>
      </div>

      {movements.length > 0 && (
        <div>
          <span className="tm2-sub">Letzte Bewegungen</span>
          <ul className="tm2-list">
            {movements.slice(0, 5).map((m) => (
              <li key={m.id}>
                <div className="grow">
                  <div>
                    {m.kind === "deposit" ? "Einzahlung" : "Auszahlung"} {m.kind === "deposit" ? "+" : "−"}
                    {formatMoney(m.amount)}
                  </div>
                  <div className="muted">
                    {m.occurredAt}
                    {m.note ? ` · ${m.note}` : ""}
                  </div>
                </div>
                <button type="button" className="icon-btn" aria-label="Bewegung löschen" onClick={() => setDeleting(m)}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="field-error">{error}</p>}

      {deleting && (
        <ConfirmDialog
          title="Bewegung löschen?"
          message={`${deleting.kind === "deposit" ? "Einzahlung" : "Auszahlung"} über ${formatMoney(deleting.amount)} wird dauerhaft gelöscht.`}
          onConfirm={() => void remove(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </Modal>
  );
}
