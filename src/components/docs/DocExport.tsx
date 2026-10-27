import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, FileDown, FileText, Folder, X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { loadBlob } from "../../lib/api/docImages";
import { safeFileName, saveDocx } from "../../lib/api/exportFile";
import { buildDocx, type ExportSection } from "../../lib/export/docx";
import { buildTree, isFolder, pageTitle, type DocNode, type DocPage } from "../../lib/docs";
import "./DocExport.css";

interface DocExportProps {
  page: DocPage;
  pages: DocPage[];
  /** Speichert Änderungen, die noch im Editor stehen, damit sie im Export sind */
  beforeExport?: () => Promise<void>;
}

/** Die Seite und, wenn gewünscht, alle Unterseiten in Reihenfolge des Baums; Unterseiten liegen eine Ebene tiefer. */
function collect(page: DocPage, pages: DocPage[], withSubpages: boolean): ExportSection[] {
  const sections: ExportSection[] = [{ title: pageTitle(page), html: isFolder(page) ? "" : page.content, level: 0 }];
  if (!withSubpages) return sections;
  const find = (nodes: DocNode[]): DocNode | undefined => {
    for (const n of nodes) {
      if (n.page.id === page.id) return n;
      const inner = find(n.children);
      if (inner) return inner;
    }
    return undefined;
  };
  const walk = (nodes: DocNode[], level: number) => {
    for (const n of nodes) {
      sections.push({ title: pageTitle(n.page), html: isFolder(n.page) ? "" : n.page.content, level });
      walk(n.children, level + 1);
    }
  };
  walk(find(buildTree(pages))?.children ?? [], 1);
  return sections;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Knopf „Als Word-Dokument exportieren“ in der Kopfzeile einer Seite. Hat die Seite Unterseiten, fragt ein kleiner Dialog,
 * ob sie mitkommen sollen (ein Ordner exportiert immer seinen Inhalt). Danach folgt der Speichern-Dialog von Windows.
 */
export function DocExport({ page, pages, beforeExport }: DocExportProps) {
  const [dialog, setDialog] = useState(false);
  const [withSubpages, setWithSubpages] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const latest = useRef({ page, pages });
  latest.current = { page, pages };

  const folder = isFolder(page);
  const subpageCount = collect(page, pages, true).length - 1;
  const nothing = folder && subpageCount === 0;

  // Die Meldung verschwindet von selbst; ein Fehler bleibt, bis man ihn schließt
  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const t = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const run = async (include: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await beforeExport?.();
      // Stand nach dem Speichern: Seite und Liste können sich in der Zwischenzeit erneuert haben
      const { page: p, pages: all } = latest.current;
      const fresh = all.find((x) => x.id === p.id) ?? p;
      const sections = collect(fresh, all, include || isFolder(fresh));
      const name = safeFileName(pageTitle(fresh));
      const path = await saveDocx(name, () => buildDocx(sections, { loadImage: loadBlob }));
      setDialog(false);
      if (path) setNotice({ kind: "ok", text: path });
    } catch (e) {
      const text = String(e);
      if (dialog) setError(text);
      else setNotice({ kind: "error", text });
    } finally {
      setBusy(false);
    }
  };

  const start = () => {
    if (busy) return;
    if (subpageCount > 0) {
      setWithSubpages(true);
      setError(null);
      setDialog(true);
    } else {
      void run(false);
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
        onClick={start}
      >
        <FileDown size={16} />
      </button>

      {dialog && (
        <Modal
          title="Als Word-Dokument exportieren"
          width={460}
          onClose={() => !busy && setDialog(false)}
          footer={
            <>
              <span className="spacer" />
              <SecondaryButton disabled={busy} onClick={() => setDialog(false)}>
                Abbrechen
              </SecondaryButton>
              <Button disabled={busy} onClick={() => void run(withSubpages)}>
                {busy ? "Exportiere …" : "Exportieren"}
              </Button>
            </>
          }
        >
          <div className="dx-summary">
            <span className="dx-icon">{folder ? <Folder size={17} /> : <FileText size={17} />}</span>
            <div>
              <strong>{pageTitle(page)}</strong>
              <span>
                {folder ? "Ordner" : "Seite"} · {count(subpageCount, "Unterseite", "Unterseiten")}
              </span>
            </div>
          </div>

          {!folder && (
            <label className="checkbox-row dx-option">
              <input type="checkbox" checked={withSubpages} onChange={(e) => setWithSubpages(e.target.checked)} />
              <span className={`check${withSubpages ? " checked" : ""}`} />
              <span>
                Unterseiten einbeziehen
                <em>Jede Unterseite wird ein eigenes Kapitel, ihre Überschriften rücken eine Ebene tiefer.</em>
              </span>
            </label>
          )}

          <p className="dx-hint">Überschriften, Listen, Tabellen und Bilder (auch in Tabellen) werden als echte Word-Elemente übernommen.</p>
          {error && <p className="field-error">{error}</p>}
        </Modal>
      )}

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
