import { useCallback, useEffect, useRef, useState } from "react";
import { parseNumber } from "./fields";

const trim = (n: number, digits: number) => String(parseFloat(n.toFixed(digits)));

/**
 * Menge und Wert (Menge × Preis) hängen zusammen: Tippt man die Menge, errechnet sich der Wert; tippt man den
 * Wert, errechnet sich die Menge. Ändert sich der Preis, bleibt das zuletzt bearbeitete Feld bestehen und das
 * andere rechnet sich neu.
 */
export function useQtyValue(price: string) {
  const [qty, setQtyRaw] = useState("");
  const [value, setValueRaw] = useState("");
  const anchor = useRef<"qty" | "value">("qty");
  const priceNum = parseNumber(price);

  const setQty = useCallback(
    (next: string) => {
      anchor.current = "qty";
      setQtyRaw(next);
      const q = parseNumber(next);
      setValueRaw(q !== null && priceNum ? trim(q * priceNum, 2) : "");
    },
    [priceNum],
  );

  const setValue = useCallback(
    (next: string) => {
      anchor.current = "value";
      setValueRaw(next);
      const v = parseNumber(next);
      setQtyRaw(v !== null && priceNum ? trim(v / priceNum, 8) : "");
    },
    [priceNum],
  );

  /** Felder auf einen Ausgangswert setzen (z. B. beim Öffnen eines Panels). */
  const reset = useCallback((nextQty: string, nextPrice: string) => {
    anchor.current = "qty";
    setQtyRaw(nextQty);
    const q = parseNumber(nextQty);
    const p = parseNumber(nextPrice);
    setValueRaw(q !== null && p ? trim(q * p, 2) : "");
  }, []);

  useEffect(() => {
    if (!priceNum) {
      if (anchor.current === "qty") setValueRaw("");
      return;
    }
    if (anchor.current === "qty") {
      const q = parseNumber(qty);
      setValueRaw(q !== null ? trim(q * priceNum, 2) : "");
    } else {
      const v = parseNumber(value);
      setQtyRaw(v !== null ? trim(v / priceNum, 8) : "");
    }
    // nur wenn sich der Preis ändert
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceNum]);

  return { qty, value, setQty, setValue, reset };
}
