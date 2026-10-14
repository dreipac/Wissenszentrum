import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { createTrade, searchSymbols } from "../../lib/api/trading";
import { formatMoney } from "../../lib/format";
import { formatPrice, type SymbolMatch, type TradeAssetClass } from "../../lib/trading";
import { CurrencySuffix, Field, NumberField, Segmented, TextSuffix, fromInput, nowInput, parseNumber } from "./fields";
import { useQtyValue } from "./useQtyValue";
import "./TradingModals.css";

interface PositionModalProps {
  cash: number;
  hasApiKey: boolean;
  onClose: () => void;
}

export function PositionModal({ cash, hasApiKey, onClose }: PositionModalProps) {
  const [kind, setKind] = useState<"position" | "order">("position");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<TradeAssetClass>("aktie");
  const [currency, setCurrency] = useState("USD");
  const [fx, setFx] = useState("");
  const [price, setPrice] = useState("");
  const qv = useQtyValue(price);
  const [fee, setFee] = useState("");
  const [at, setAt] = useState(nowInput);
  const [validUntil, setValidUntil] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");
  const [thesis, setThesis] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Symbol-Vorschläge über Finnhub (nur mit API-Key)
  useEffect(() => {
    if (!hasApiKey || symbol.trim().length < 1) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      searchSymbols(symbol.trim())
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [symbol, hasApiKey]);

  const onSymbol = (value: string) => {
    setSymbol(value);
    // Gewählter Vorschlag füllt den Namen, solange noch keiner eingetragen ist
    const match = suggestions.find((s) => s.symbol === value.trim().toUpperCase());
    if (match && !name.trim()) setName(match.description);
  };

  // Live-Rechnung: alles hier hängt direkt an den Eingaben
  const qty = parseNumber(qv.qty);
  const unitPrice = parseNumber(price);
  const feeValue = kind === "position" ? (parseNumber(fee) ?? 0) : 0;
  const rate = currency === "CHF" ? 1 : parseNumber(fx);
  const worth = qty !== null && unitPrice !== null ? qty * unitPrice : null;
  const costChf = worth !== null && rate !== null ? (worth + feeValue) * rate : null;
  const cashAfter = costChf !== null ? cash - costChf : null;
  const tooExpensive = kind === "position" && cashAfter !== null && cashAfter < -0.005;
  const money = (v: number) => `${formatPrice(v)} ${currency}`;

  const save = async () => {
    if (!symbol.trim()) return setError("Bitte gib ein Symbol ein.");
    if (qty === null || qty <= 0) return setError("Bitte gib eine Menge größer als 0 ein.");
    if (unitPrice === null || unitPrice <= 0) return setError("Bitte gib einen Preis größer als 0 ein.");
    if (rate === null || rate <= 0) return setError(`Bitte gib den Wechselkurs ein (CHF je 1 ${currency}).`);
    if (tooExpensive) return setError("Das Guthaben reicht nicht. Lade zuerst Guthaben auf.");
    setBusy(true);
    setError(null);
    try {
      await createTrade({
        kind,
        symbol,
        name,
        assetClass,
        currency,
        fxRate: rate,
        quantity: qty,
        price: unitPrice,
        fee: feeValue,
        executedAt: fromInput(at),
        stopLoss: parseNumber(stopLoss),
        target: parseNumber(target),
        thesis,
        validUntil: validUntil || null,
      });
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  // Alle Geldfelder teilen sich dieselbe Währung
  const cur = <CurrencySuffix value={currency} onChange={setCurrency} />;

  return (
    <Modal
      title="Neue Position"
      width={660}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <Button disabled={busy} onClick={() => void save()}>
            {kind === "position" ? "Position eröffnen" : "Order anlegen"}
          </Button>
        </>
      }
    >
      <Segmented
        label="Art"
        value={kind}
        onChange={setKind}
        options={[
          { id: "position", label: "Position (gekauft)" },
          { id: "order", label: "Order (geplant)" },
        ]}
      />

      <div className="tm2-grid">
        <Field label="Symbol" id="pos-symbol" hint={hasApiKey ? "Vorschläge über Finnhub" : "z. B. BLK, NVDA oder BINANCE:BTCUSDT"}>
          <input
            id="pos-symbol"
            className="field-control"
            list="pos-symbol-list"
            value={symbol}
            placeholder="z. B. BLK"
            autoFocus
            onChange={(e) => onSymbol(e.target.value)}
          />
          <datalist id="pos-symbol-list">
            {suggestions.map((s) => (
              <option key={s.symbol} value={s.symbol}>
                {s.description}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label="Name (optional)" id="pos-name">
          <input id="pos-name" className="field-control" value={name} placeholder="z. B. BlackRock" onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Anlageklasse" id="pos-class">
          <select id="pos-class" className="field-control" value={assetClass} onChange={(e) => setAssetClass(e.target.value as TradeAssetClass)}>
            <option value="aktie">Aktie</option>
            <option value="krypto">Krypto</option>
          </select>
        </Field>
        {kind === "position" ? (
          <Field label="Zeitpunkt des Kaufs" id="pos-at">
            <input id="pos-at" className="field-control" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
        ) : (
          <Field label="Gültig bis (optional)" id="pos-valid" hint="Leer = bis auf Widerruf">
            <input id="pos-valid" className="field-control" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </Field>
        )}

        <NumberField
          label="Menge"
          id="pos-qty"
          value={qv.qty}
          onChange={qv.setQty}
          placeholder={assetClass === "aktie" ? "Stück" : "z. B. 0.085"}
          suffix={assetClass === "aktie" ? <TextSuffix>Stk.</TextSuffix> : undefined}
        />
        <NumberField label={kind === "position" ? "Einstiegspreis" : "Limit-Preis"} id="pos-price" value={price} onChange={setPrice} suffix={cur} />

        <NumberField
          label="Wert (Menge × Preis)"
          id="pos-worth"
          value={qv.value}
          onChange={qv.setValue}
          placeholder="Betrag eintippen, um die Menge zu errechnen"
          suffix={cur}
        />
        {kind === "position" ? (
          <NumberField label="Gebühr (optional)" id="pos-fee" value={fee} onChange={setFee} placeholder="0" suffix={cur} />
        ) : (
          <div />
        )}

        {currency !== "CHF" && (
          <div className="full">
            <NumberField
              label={`Wechselkurs (CHF je 1 ${currency})`}
              id="pos-fx"
              value={fx}
              onChange={setFx}
              placeholder="z. B. 0.90"
              hint="Wird von Hand gepflegt und für die Umrechnung in CHF verwendet."
              suffix={<TextSuffix>CHF</TextSuffix>}
            />
          </div>
        )}

        <NumberField label="Stop-Loss (optional)" id="pos-stop" value={stopLoss} onChange={setStopLoss} suffix={cur} />
        <NumberField label="Ziel (optional)" id="pos-target" value={target} onChange={setTarget} suffix={cur} />

        <div className="full">
          <Field label="Grund / These (optional)" id="pos-thesis">
            <textarea id="pos-thesis" className="field-control" value={thesis} placeholder="Warum dieser Trade?" onChange={(e) => setThesis(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className="tm2-summary" aria-live="polite">
        <div>
          <span>Wert (Menge × Preis)</span>
          <strong>{worth === null ? "–" : money(worth)}</strong>
        </div>
        {feeValue > 0 && (
          <div>
            <span>Gebühr</span>
            <strong>{money(feeValue)}</strong>
          </div>
        )}
        <div>
          <span>
            {kind === "position" ? "Kaufbetrag" : "Geplanter Betrag"}
            {currency !== "CHF" && rate !== null && ` (Kurs ${formatPrice(rate)})`}
          </span>
          <strong>{costChf === null ? "–" : formatMoney(costChf)}</strong>
        </div>
        {kind === "position" && (
          <>
            <div>
              <span>Guthaben jetzt</span>
              <strong>{formatMoney(cash)}</strong>
            </div>
            <div className={tooExpensive ? "warn" : ""}>
              <span>Guthaben danach</span>
              <strong>{cashAfter === null ? "–" : formatMoney(cashAfter)}</strong>
            </div>
          </>
        )}
      </div>

      {error && <p className="field-error">{error}</p>}
    </Modal>
  );
}
