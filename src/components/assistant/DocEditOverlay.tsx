import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Minus, PenLine, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { useEditorTheme } from "../../lib/editorTheme";
import type { DocBlock, EditLine, ShownBlock } from "../../lib/docBlocks";
import { DocPageBlocks } from "./DocPagePreview";
import { EditChips, type DocEditItem } from "./DocEditCard";
import "../../views/NotesView.css";
import "../../views/DocsView.css";
import "./DocsPreview.css";

/** Kurzbeschreibung eines Bausteins für die Liste der Änderungen. */
function summarize(shown: ShownBlock | null, blocks?: DocBlock[]): string {
  const b = blocks?.[0] ?? shown?.block ?? null;
  const more = blocks && blocks.length > 1 ? ` + ${blocks.length - 1} weitere` : "";
  // Die Auszeichnung (**fett**, *kursiv*, `Code`) gehört nicht in die Kurzfassung
  const cut = (raw: string) => {
    const t = raw.replace(/\*\*|\*|`/g, "");
    return t.length > 46 ? `${t.slice(0, 45)}…` : t;
  };
  if (!b) return `${shown?.label ?? "Baustein"}${more}`;
  switch (b.type) {
    case "heading":
      return `Überschrift „${cut(b.text)}“${more}`;
    case "paragraph":
    case "quote":
      return `${b.type === "quote" ? "Zitat" : "Absatz"} „${cut(b.text)}“${more}`;
    case "code":
      return `Code${more}`;
    case "bullet_list":
    case "numbered_list":
      return `Liste (${b.items.length} Einträge)${more}`;
    case "table":
      return `Tabelle (${b.headers.length} × ${b.rows.length + 1})${more}`;
    case "divider":
      return `Trennlinie${more}`;
  }
}

/** Ein unveränderter oder ersetzter Baustein der Seite: als Baustein oder, wenn nicht darstellbar, als Platzhalter. */
function Existing({ shown }: { shown: ShownBlock }) {
  if (shown.block) return <DocPageBlocks blocks={[shown.block]} />;
  return (
    <div className="dpv-opaque">
      <strong>{shown.label}</strong>
      {shown.text && <span>{shown.text}</span>}
      <em>bleibt unverändert</em>
    </div>
  );
}

interface Change {
  index: number;
  kind: EditLine["kind"];
  text: string;
}

interface DocEditOverlayProps {
  item: DocEditItem;
  onApply: () => void;
  /** Schließt die Vorschau, der Vorschlag bleibt im Chat offen */
  onClose: () => void;
  onDiscard: () => void;
}

/**
 * Große Vorschau einer Seitenänderung in der Mitte des Fensters: die ganze Seite so, wie sie danach aussieht, mit
 * grün hervorgehobenem Neuen und rot hervorgehobenem Entfallendem. Links die Liste der Änderungen zum Anspringen.
 * Bestätigt wird hier; erst dann ändert sich die Seite.
 */
export function DocEditOverlay({ item, onApply, onClose, onDiscard }: DocEditOverlayProps) {
  const { data, status, error } = item;
  const { theme } = useEditorTheme();
  const busy = status === "applying";
  const [onlyChanges, setOnlyChanges] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  const changes = useMemo<Change[]>(
    () =>
      data.lines.flatMap((l, index) => {
        if (l.kind === "same") return [];
        const text =
          l.kind === "added" ? `Neu: ${summarize(null, l.new)}` : l.kind === "removed" ? `Entfernt: ${summarize(l.old)}` : `Ersetzt: ${summarize(l.old)}`;
        return [{ index, kind: l.kind, text }];
      }),
    [data.lines],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const jump = (index: number) => stage.current?.querySelector(`[data-line="${index}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });

  // Beim Öffnen zur ersten Änderung springen
  useEffect(() => {
    const first = changes[0];
    if (first) window.setTimeout(() => stage.current?.querySelector(`[data-line="${first.index}"]`)?.scrollIntoView({ block: "center" }), 60);
    // nur beim Öffnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Zeilen für die Anzeige; mit „Nur Änderungen“ werden Reihen unveränderter Bausteine zu einer Zeile zusammengefasst. */
  const view = useMemo(() => {
    const out: ({ line: EditLine; index: number } | { gap: number; key: number })[] = [];
    let run = 0;
    data.lines.forEach((line, index) => {
      if (onlyChanges && line.kind === "same") {
        run++;
        return;
      }
      if (run > 0) out.push({ gap: run, key: index });
      run = 0;
      out.push({ line, index });
    });
    if (run > 0) out.push({ gap: run, key: data.lines.length });
    return out;
  }, [data.lines, onlyChanges]);

  const path = [data.path, data.title].filter(Boolean).join(" › ");

  return (
    <div className="dpv-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dpv" role="dialog" aria-modal="true" aria-label="Vorschau: Seite ändern">
        <header className="dpv-head">
          <span className="dpv-head-icon">
            <PenLine size={17} />
          </span>
          <div className="dpv-head-text">
            <h2>Seite ändern</h2>
            <p>{path}</p>
          </div>
          <div className="dpv-stats">
            <EditChips edit={data} />
          </div>
          <button type="button" className="icon-btn" aria-label="Vorschau schließen" title="Schließen (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="dpv-body">
          <nav className="dpv-tree" aria-label="Änderungen">
            <span className="dpv-label">Änderungen</span>
            {data.newTitle && (
              <p className="dpv-titlechange">
                <RefreshCw size={13} />
                <span>
                  Titel: <s>{data.title}</s> <ArrowRight size={11} /> <b>{data.newTitle}</b>
                </span>
              </p>
            )}
            <ul>
              {changes.map((c) => (
                <li key={c.index}>
                  <button type="button" className={`dpv-change ${c.kind}`} onClick={() => jump(c.index)}>
                    {c.kind === "added" ? <Plus size={13} /> : c.kind === "removed" ? <Minus size={13} /> : <RefreshCw size={13} />}
                    <span>{c.text}</span>
                  </button>
                </li>
              ))}
            </ul>
            {changes.length === 0 && !data.newTitle && <p className="dpv-none">Keine Änderungen am Inhalt.</p>}
            <label className="checkbox-row dpv-toggle">
              <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
              <span className={`check sm${onlyChanges ? " checked" : ""}`} />
              Nur Änderungen zeigen
            </label>
          </nav>

          <div ref={stage} className="dpv-stage docs-scroll" data-editor-theme={theme}>
            <article className="doc-article dpv-article">
              <p className="dpv-path">{path}</p>
              <h1 className="dpv-title">
                {data.newTitle ? (
                  <>
                    <span className="dpv-oldtitle">{data.title}</span>
                    <span className="dpv-newtitle">{data.newTitle}</span>
                  </>
                ) : (
                  data.title
                )}
              </h1>
              <div className="doc-meta">
                <span>Vorschau der Änderung</span>
                <span className="doc-meta-dot">·</span>
                <span>noch nicht übernommen</span>
              </div>

              <div className="note-prose doc-prose">
                {view.map((entry) => {
                  if ("gap" in entry) {
                    return (
                      <p key={`gap-${entry.key}`} className="dpv-gap">
                        {entry.gap === 1 ? "1 unveränderter Baustein" : `${entry.gap} unveränderte Bausteine`}
                      </p>
                    );
                  }
                  const { line, index } = entry;
                  return (
                    <div key={index} data-line={index} className={`dpv-line ${line.kind}`}>
                      {(line.kind === "same" || line.kind === "replaced" || line.kind === "removed") && line.old && (
                        <div className={line.kind === "same" ? undefined : "dpv-diff removed"}>
                          {line.kind !== "same" && <span className="dpv-tag">Entfällt</span>}
                          <Existing shown={line.old} />
                        </div>
                      )}
                      {(line.kind === "added" || line.kind === "replaced") && (
                        <div className="dpv-diff added">
                          <span className="dpv-tag">Neu</span>
                          <DocPageBlocks blocks={line.new} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          </div>
        </div>

        <footer className="dpv-foot">
          <div className="dpv-notes">
            <p className="dpv-legend">
              <i className="added" /> neu <i className="removed" /> entfällt
            </p>
            {error && <p className="dpv-error">{error}</p>}
          </div>
          <SecondaryButton disabled={busy} onClick={onDiscard}>
            Verwerfen
          </SecondaryButton>
          <Button disabled={busy} onClick={onApply}>
            <Check size={15} />
            {busy ? "Übernehme …" : "Änderungen übernehmen"}
          </Button>
        </footer>
      </section>
    </div>
  );
}
