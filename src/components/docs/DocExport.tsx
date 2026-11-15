import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FileDown, X } from "lucide-react";
import { isFolder, type DocPage } from "../../lib/docs";
import { collectSections, ExportModal } from "./ExportModal";
import "./DocExport.css";

interface DocExportProps {
  page: DocPage;
  pages: DocPage[];
  /** Speichert Änderungen, die noch im Editor stehen, damit sie im Export sind */
  beforeExport?: () => Promise<void>;
}

/**
 * Knopf „Als Word-Dokument exportieren“ in der Kopfzeile einer Seite. Er öffnet das Export-Fenster mit Vorschau und
 * Einstellungen; danach folgt der Speichern-Dialog von Windows. Die Rückmeldung zeigt, wo die Datei liegt.
 */
export function DocExport({ page, pages, beforeExport }: DocExportProps) {
  const [open, setOpen] = useState<{ page: DocPage; pages: DocPage[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const latest = useRef({ page, pages });
  latest.current = { page, pages };

  const nothing = isFolder(page) && collectSections(page, pages, true).length === 1;

  // Die Meldung verschwindet von selbst; ein Fehler bleibt, bis man ihn schließt
  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const t = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await beforeExport?.();
      // Stand nach dem Speichern: Seite und Liste können sich in der Zwischenzeit erneuert haben
      const { page: p, pages: all } = latest.current;
      setOpen({ page: all.find((x) => x.id === p.id) ?? p, pages: all });
    } catch (e) {
      setNotice({ kind: "error", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        aria-label="Als Word-Dokument exportieren"
        title={nothing ? "Dieser Ordner ist leer" : "Als Word-Dokument exportieren"}
        disabled={busy || nothing}
        onClick={() => void start()}
      >
        <FileDown size={16} />
      </button>

      {open && <ExportModal page={open.page} pages={open.pages} onClose={() => setOpen(null)} onExported={(path) => setNotice({ kind: "ok", text: path })} />}

      {notice &&
        createPortal(
          <div className={`dx-toast ${notice.kind}`} role="status">
            {notice.kind === "ok" ? <Check size={15} /> : <X size={15} />}
            <div className="dx-toast-text">
              <strong>{notice.kind === "ok" ? "Als Word-Dokument gespeichert" : "Export fehlgeschlagen"}</strong>
              <span>{notice.text}</span>
            </div>
            <button type="button" className="icon-btn" aria-label="Schließen" onClick={() => setNotice(null)}>
              <X size={14} />
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
