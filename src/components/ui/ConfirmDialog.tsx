import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { SecondaryButton } from "./SecondaryButton";
import "./ConfirmDialog.css";

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Kleine Rückfrage vor einer unwiderruflichen Aktion. Wird per Portal in den body gerendert,
 * damit sie über einem geöffneten Dialog liegt (dessen Animation würde sie sonst einsperren).
 */
export function ConfirmDialog({ title, message, confirmLabel = "Löschen", busy, onConfirm, onCancel }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Sicherer Standard: Fokus auf „Abbrechen“, damit Enter nichts löscht
  useEffect(() => cancelRef.current?.focus(), []);

  // Escape schließt nur diese Rückfrage, nicht den Dialog darunter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return createPortal(
    <div className="confirm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="confirm-box" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2 className="confirm-title">{title}</h2>
        {message && <p className="confirm-message">{message}</p>}
        <div className="confirm-actions">
          <SecondaryButton ref={cancelRef} onClick={onCancel}>
            Abbrechen
          </SecondaryButton>
          <Button className="confirm-danger" disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
