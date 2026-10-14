import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { createMetal, deleteMetal, updateMetal } from "../../lib/api/trading";
import { formatMoney, formatPercent } from "../../lib/format";
import { formatNoteTime } from "../../lib/notes";
import { metalLabel, quantityInOz, unitLabel, type Metal, type MetalKind, type MetalUnit } from "../../lib/trading";
import { SuffixSelect } from "../ui/SuffixSelect";
import { Field, NumberField, TextSuffix, parseNumber } from "./fields";
import "./TradingModals.css";

interface MetalModalProps {
  /** Ohne Angabe wird ein neues Edelmetall erfasst, sonst dieses bearbeitet. */
  metal?: Metal;
  onClose: () => void;
}

export function MetalModal({ metal, onClose }: MetalModalProps) {
  const editing = metal !== undefined;
  const [kind, setKind] = useState<MetalKind>(metal?.metal ?? "gold");
  const [name, setName] = useState(metal?.name ?? "");
  const [quantity, setQuantity] = useState(metal ? String(metal.quantity) : "");
  const [unit, setUnit] = useState<MetalUnit>(metal?.unit ?? "g");
  const [cost, setCost] = useState(metal?.costChf != null ? String(metal.costChf) : "");
  const [spot, setSpot] = useState(metal?.spotChfPerOz != null ? String(metal.spotChfPerOz) : "");
  const [note, setNote] = useState(metal?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const qty = parseNumber(quantity);
  const spotValue = parseNumber(spot);
  const costValue = parseNumber(cost);
  const value = qty !== null && spotValue !== null ? quantityInOz(qty, unit) * spotValue : null;
  const pnlPct = value !== null && costValue ? ((value - costValue) / costValue) * 100 : null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const save = () => {
    if (!name.trim()) return setError("Bitte gib eine Bezeichnung ein.");
    if (qty === null || qty <= 0) return setError("Bitte gib eine Menge größer als 0 ein.");
    const input = { name, metal: kind, quantity: qty, unit, costChf: costValue, spotChfPerOz: spotValue, note };
    void run(() => (editing ? updateMetal(metal.id, input) : createMetal(input)));
  };

  return (
    <Modal
      title={editing ? "Edelmetall bearbeiten" : "Edelmetall erfassen"}
      width={560}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <SecondaryButton className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Löschen
            </SecondaryButton>
          )}
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <Button disabled={busy} onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="tm2-grid">
        <Field label="Metall" id="mt-kind">
          <select id="mt-kind" className="field-control" value={kind} onChange={(e) => setKind(e.target.value as MetalKind)}>
            {(Object.keys(metalLabel) as MetalKind[]).map((k) => (
              <option key={k} value={k}>
                {metalLabel[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bezeichnung" id="mt-name">
          <input id="mt-name" className="field-control" value={name} placeholder="z. B. Gold Barren" autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <NumberField
          label="Menge"
          id="mt-qty"
          value={quantity}
          onChange={setQuantity}
          suffix={<SuffixSelect value={unit} options={Object.keys(unitLabel)} onChange={(u) => setUnit(u as MetalUnit)} ariaLabel="Einheit" />}
        />
        <NumberField label="Kaufpreis gesamt (optional)" id="mt-cost" value={cost} onChange={setCost} suffix={<TextSuffix>CHF</TextSuffix>} />
        <NumberField
          label="Spotpreis (je Feinunze)"
          id="mt-spot"
          value={spot}
          onChange={setSpot}
          suffix={<TextSuffix>CHF / oz</TextSuffix>}
          hint={metal?.spotUpdatedAt ? `Zuletzt geändert ${formatNoteTime(metal.spotUpdatedAt)}` : "Von Hand, z. B. von deinem Händler"}
        />
        <div className="full">
          <Field label="Notiz (optional)" id="mt-note">
            <textarea id="mt-note" className="field-control" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="tm2-summary">
        <div>
          <span>Aktueller Wert</span>
          <strong>{value === null ? "kein Spotpreis" : formatMoney(value)}</strong>
        </div>
        {pnlPct !== null && (
          <div>
            <span>Entwicklung seit Kauf</span>
            <strong className={pnlPct >= 0 ? "tr-pos" : "tr-neg"}>{formatPercent(pnlPct)}</strong>
          </div>
        )}
      </div>

      {error && <p className="field-error">{error}</p>}

      {confirmDelete && editing && (
        <ConfirmDialog
          title="Edelmetall löschen?"
          message={`„${metal.name}“ wird dauerhaft gelöscht.`}
          busy={busy}
          onConfirm={() => void run(() => deleteMetal(metal.id))}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
