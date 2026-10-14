import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { getApiKey, saveApiKey } from "../../lib/api/trading";

interface SettingsModalProps {
  onClose: () => void;
}

/** Einstellungen. Bisher: Finnhub-API-Key für Aktien- und Krypto-Kurse. */
export function SettingsModal({ onClose }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    getApiKey()
      .then((key) => {
        setApiKey(key);
        setSaved(key);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await saveApiKey(apiKey);
      setSaved(apiKey.trim());
      setApiKey(apiKey.trim());
      setOk(apiKey.trim() ? "API-Key geprüft und gespeichert." : "API-Key entfernt.");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Einstellungen"
      width={560}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Schließen</SecondaryButton>
          <Button disabled={busy || apiKey.trim() === saved} onClick={() => void save()}>
            {busy ? "Prüfe …" : apiKey.trim() ? "Testen und speichern" : "Entfernen"}
          </Button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="settings-finnhub">Finnhub API-Key</label>
        <input
          id="settings-finnhub"
          className="field-control"
          value={apiKey}
          placeholder="Key von finnhub.io einfügen"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setApiKey(e.target.value);
            setOk(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && apiKey.trim() !== saved && void save()}
        />
        <span className="field-hint">
          Wird für aktuelle Aktien- und Krypto-Kurse und die Symbolsuche im Trading-Bereich verwendet. Der kostenlose Key von finnhub.io
          reicht. Der Key wird lokal in deiner Datenbank gespeichert.
        </span>
      </div>
      {ok && <p className="settings-ok">{ok}</p>}
      {error && <p className="field-error">{error}</p>}
    </Modal>
  );
}
