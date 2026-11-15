import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { loadBlob } from "../../lib/api/docImages";
import { safeFileName, saveDocx } from "../../lib/api/exportFile";
import { buildDocx, type ExportSection, type ImageCache } from "../../lib/export/docx";
import {
  DEFAULT_EXPORT_SETTINGS,
  EXPORT_FONTS,
  FONT_SIZES,
  TABLE_WIDTH_MAX,
  TABLE_WIDTH_MIN,
  loadExportSettings,
  saveExportSettings,
  type ExportSettings,
  type Level,
} from "../../lib/export/settings";
import { buildTree, isFolder, pageTitle, type DocNode, type DocPage } from "../../lib/docs";
import "./ExportModal.css";

/** Die Seite und, wenn gewünscht, alle Unterseiten in Reihenfolge des Baums; Unterseiten liegen eine Ebene tiefer. */
export function collectSections(page: DocPage, pages: DocPage[], withSubpages: boolean): ExportSection[] {
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

interface ExportModalProps {
  page: DocPage;
  pages: DocPage[];
  onClose: () => void;
  /** Der Ort der gespeicherten Datei */
  onExported: (path: string) => void;
}

const PREVIEW_DELAY_MS = 250;

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`checkbox-row xm-toggle${disabled ? " disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={`check${checked ? " checked" : ""}`} />
      <span>{label}</span>
    </label>
  );
}

function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div className="xm-row">
      <span className="xm-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="xm-group">
    <h3>{title}</h3>
    {children}
  </section>
);

const LEVELS = (a: string, b: string, c: string): { value: Level; label: string }[] => [
  { value: "tight", label: a },
  { value: "normal", label: b },
  { value: "wide", label: c },
];

/**
 * „Als Word-Dokument exportieren“: links die Vorschau, rechts die Einstellungen. Die Vorschau zeigt die echte Word-Datei,
 * die der Export bauen würde (dieselbe Funktion, dieselben Einstellungen), und erneuert sich beim Ändern von selbst.
 */
export function ExportModal({ page, pages, onClose, onExported }: ExportModalProps) {
  const folder = isFolder(page);
  const subpageCount = useMemo(() => collectSections(page, pages, true).length - 1, [page, pages]);
  const [settings, setSettings] = useState<ExportSettings>(loadExportSettings);
  const [withSubpages, setWithSubpages] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);

  const sections = useMemo(() => collectSections(page, pages, withSubpages || folder), [page, pages, withSubpages, folder]);
  const images = useRef<ImageCache>(new Map());
  const stage = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const token = useRef(0);

  const set = <K extends keyof ExportSettings>(key: K, value: ExportSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  useEffect(() => saveExportSettings(settings), [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  /** Die Seiten so verkleinern, dass sie in die Breite der Vorschau passen */
  const fitPages = () => {
    const box = stage.current;
    const area = viewport.current;
    const first = box?.querySelector<HTMLElement>("section");
    if (!box || !area || !first) return;
    box.style.zoom = "1";
    const available = area.clientWidth - 40;
    const scale = Math.min(1, available / first.offsetWidth);
    box.style.zoom = String(scale);
  };

  // Vorschau: die Datei bauen und mit docx-preview zeigen. Das Neue entsteht abseits und ersetzt das Alte erst, wenn es fertig ist.
  useEffect(() => {
    const mine = ++token.current;
    setRendering(true);
    const timer = window.setTimeout(async () => {
      try {
        const bytes = await buildDocx(sections, { loadImage: loadBlob, settings, imageCache: images.current });
        const { renderAsync } = await import("docx-preview");
        const fresh = document.createElement("div");
        await renderAsync(new Blob([bytes as BlobPart]), fresh, fresh, {
          className: "dxp",
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: true,
          renderHeaders: false,
          renderFooters: true,
        });
        if (mine !== token.current || !stage.current) return;
        stage.current.replaceChildren(...Array.from(fresh.childNodes));
        setPageCount(stage.current.querySelectorAll("section").length);
        setPreviewError(null);
        fitPages();
      } catch (e) {
        if (mine === token.current) setPreviewError(String(e));
      } finally {
        if (mine === token.current) setRendering(false);
      }
    }, PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [sections, settings]);

  // Ändert sich die Breite des Fensters, passt sich der Maßstab an
  useEffect(() => {
    const area = viewport.current;
    if (!area) return;
    const observer = new ResizeObserver(fitPages);
    observer.observe(area);
    return () => observer.disconnect();
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await saveDocx(safeFileName(pageTitle(page)), () => buildDocx(sections, { loadImage: loadBlob, settings, imageCache: images.current }));
      if (path) {
        onExported(path);
        onClose();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const changed = JSON.stringify(settings) !== JSON.stringify(DEFAULT_EXPORT_SETTINGS);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="xm-box" role="dialog" aria-modal="true" aria-label="Als Word-Dokument exportieren">
        <header className="modal-head">
          <h2>Als Word-Dokument exportieren</h2>
          <button type="button" className="icon-btn" aria-label="Schließen" disabled={busy} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="xm-body">
          <div className="xm-preview">
            <div className="xm-preview-head">
              <span>Vorschau</span>
              <span className={`xm-status${rendering ? " busy" : ""}`}>{rendering ? "Wird aktualisiert" : pageCount !== null ? `${pageCount} ${pageCount === 1 ? "Seite" : "Seiten"}` : ""}</span>
            </div>
            <div className="xm-viewport" ref={viewport}>
              <div className="xm-stage" ref={stage} />
              {previewError && <p className="field-error xm-preview-error">Die Vorschau konnte nicht erstellt werden: {previewError}</p>}
            </div>
          </div>

          <div className="xm-settings">
            {!folder && subpageCount > 0 && (
              <Group title="Inhalt">
                <Toggle label={`Unterseiten einbeziehen (${subpageCount})`} checked={withSubpages} onChange={setWithSubpages} />
                <Toggle label="Jede Unterseite auf neuer Seite" checked={settings.chapterBreaks} disabled={!withSubpages} onChange={(v) => set("chapterBreaks", v)} />
              </Group>
            )}
            {folder && subpageCount > 0 && (
              <Group title="Inhalt">
                <Toggle label="Jede Unterseite auf neuer Seite" checked={settings.chapterBreaks} onChange={(v) => set("chapterBreaks", v)} />
              </Group>
            )}

            <Group title="Kopf">
              <Toggle label="Titel" checked={settings.showTitle} onChange={(v) => set("showTitle", v)} />
              <Toggle label="Exportvermerk" checked={settings.showNote} onChange={(v) => set("showNote", v)} />
              <Toggle label="Trennlinie unter dem Kopf" checked={settings.showHeaderRule} onChange={(v) => set("showHeaderRule", v)} />
            </Group>

            <Group title="Text">
              <div className="xm-row">
                <label className="xm-label" htmlFor="xm-font">
                  Schriftart
                </label>
                <select id="xm-font" className="field-control xm-select" value={settings.font} onChange={(e) => set("font", e.target.value)}>
                  {EXPORT_FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              <Choice label="Schriftgröße" value={settings.fontPt} options={FONT_SIZES.map((n) => ({ value: n, label: `${n} pt` }))} onChange={(v) => set("fontPt", v)} />
              <Choice label="Zeilenabstand" value={settings.lineSpacing} options={LEVELS("Eng", "Normal", "Weit")} onChange={(v) => set("lineSpacing", v)} />
              <Toggle label="Trennlinien im Text" checked={settings.contentRules} onChange={(v) => set("contentRules", v)} />
            </Group>

            <Group title="Tabellen">
              <div className="xm-row xm-slider">
                <label className="xm-label" htmlFor="xm-table-width">
                  Breite
                </label>
                <input
                  id="xm-table-width"
                  type="range"
                  min={TABLE_WIDTH_MIN}
                  max={TABLE_WIDTH_MAX}
                  step={5}
                  value={settings.tableWidthPct}
                  onChange={(e) => set("tableWidthPct", Number(e.target.value))}
                />
                <output htmlFor="xm-table-width">{settings.tableWidthPct} %</output>
              </div>
              <Choice label="Zellenabstand" value={settings.tableCellPadding} options={LEVELS("Kompakt", "Normal", "Weit")} onChange={(v) => set("tableCellPadding", v)} />
              <Toggle label="Linien zwischen den Zellen" checked={settings.tableBorders} onChange={(v) => set("tableBorders", v)} />
            </Group>

            <Group title="Seite">
              <Choice label="Format" value={settings.landscape ? "landscape" : "portrait"} options={[{ value: "portrait", label: "Hoch" }, { value: "landscape", label: "Quer" }]} onChange={(v) => set("landscape", v === "landscape")} />
              <Choice label="Ränder" value={settings.margins} options={LEVELS("Schmal", "Normal", "Breit")} onChange={(v) => set("margins", v)} />
              <Toggle label="Seitenzahl" checked={settings.pageNumbers} onChange={(v) => set("pageNumbers", v)} />
            </Group>
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="xm-reset" disabled={!changed || busy} onClick={() => setSettings({ ...DEFAULT_EXPORT_SETTINGS })}>
            Zurücksetzen
          </button>
          {error && <span className="field-error xm-error">{error}</span>}
          <span className="spacer" />
          <SecondaryButton disabled={busy} onClick={onClose}>
            Abbrechen
          </SecondaryButton>
          <Button disabled={busy} onClick={() => void run()}>
            {busy ? "Exportiere …" : "Exportieren"}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
