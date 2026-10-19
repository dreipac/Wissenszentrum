import { ChevronRight } from "lucide-react";
import { Modal } from "../ui/Modal";
import { SecondaryButton } from "../ui/SecondaryButton";
import type { HoldingRow } from "../../lib/tradingModel";
import { formatMoney, formatPercent, formatSigned } from "../../lib/format";
import { assetClassLabel, formatPrice, formatQuantity, type Trade } from "../../lib/trading";
import { AssetInsight } from "./AssetInsight";
import "./TradingModals.css";

interface AssetModalProps {
  holding: HoldingRow;
  /** Offene Positionen dieses Assets */
  trades: Trade[];
  onOpenTrade: (id: number) => void;
  onClose: () => void;
}

const tone = (v: number) => (v >= 0 ? "tr-pos" : "tr-neg");

/** Ein Asset (Aktie oder Krypto) mit Kursverlauf, Kennzahlen und den Positionen, aus denen es besteht. */
export function AssetModal({ holding, trades, onOpenTrade, onClose }: AssetModalProps) {
  const { symbol = holding.tag, currency = "USD", avgPrice = null, price = null } = holding;
  const cost = trades.reduce((s, t) => s + t.costChf, 0);
  const pnl = holding.valueChf - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : null;
  const isChf = currency === "CHF";

  return (
    <Modal
      title={holding.name}
      width={760}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Schließen</SecondaryButton>
        </>
      }
    >
      <div className="tr-trade-head">
        <span className="tr-badge">{symbol}</span>
        <span className="tr-sub">
          {assetClassLabel[holding.assetClass]} · {currency}
        </span>
      </div>

      <div className="tr-kpis">
        <div className="tr-kpi">
          <span className="tr-kpi-label">Menge</span>
          <span className="tr-kpi-value">{holding.amount}</span>
        </div>
        <div className="tr-kpi">
          <span className="tr-kpi-label">Wert</span>
          <span className="tr-kpi-value">{formatMoney(holding.valueChf)}</span>
          {holding.estimated && <span className="tr-kpi-sub">ohne aktuellen Kurs geschätzt</span>}
        </div>
        <div className="tr-kpi">
          <span className="tr-kpi-label">Gewinn / Verlust</span>
          <span className={`tr-kpi-value ${tone(pnl)}`}>{formatSigned(pnl)} CHF</span>
          {pnlPct !== null && <span className={`tr-kpi-sub ${tone(pnlPct)}`}>{formatPercent(pnlPct)}</span>}
        </div>
        <div className="tr-kpi">
          <span className="tr-kpi-label">Ø Einstieg</span>
          <span className="tr-kpi-value">{avgPrice !== null ? `${formatPrice(avgPrice)} ${currency}` : "–"}</span>
          {!isChf && trades[0] && <span className="tr-kpi-sub">1 {currency} = {formatPrice(trades[0].fxRate)} CHF</span>}
        </div>
      </div>

      <AssetInsight symbol={symbol} assetClass={holding.assetClass === "krypto" ? "krypto" : "aktie"} currency={currency} price={price} entry={avgPrice} />

      {trades.length > 0 && (
        <div>
          <span className="tm2-sub">{trades.length === 1 ? "Position" : "Positionen"}</span>
          <ul className="tr-asset-trades">
            {trades.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onOpenTrade(t.id)}>
                  <span>
                    {formatQuantity(t.quantity)} {t.assetClass === "aktie" ? "Stk." : t.symbol} · Ø {formatPrice(t.avgPrice)} {t.currency}
                  </span>
                  <ChevronRight size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
