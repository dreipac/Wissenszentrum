import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, Folder, Search, X } from "lucide-react";
import { ancestors, buildTree, isFolder, pageTitle, type DocNode, type DocPage } from "../../lib/docs";
import { useDocs } from "../../lib/useDocs";
import "./Projects.css";

interface DocPickerProps {
  /** Gewählter Ordner oder gewählte Seite (null = keine) */
  value: number | null;
  onChange: (id: number | null) => void;
}

const SEARCH_FROM = 10;

/**
 * Auswahl eines Ordners oder einer Seite der Dokumentation als Baum, bei vielen Einträgen mit Suche. Die Wahl steht oben mit
 * ihrem Pfad und lässt sich dort entfernen; beim Öffnen scrollt die Liste zur gewählten Zeile.
 */
export function DocPicker({ value, onChange }: DocPickerProps) {
  const { pages, loaded } = useDocs();
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const tree = useMemo(() => buildTree(pages), [pages]);
  const q = query.trim().toLowerCase();

  const pathOf = (page: DocPage) => ancestors(pages, page.id).map(pageTitle).join(" › ");
  const chosen = value === null ? undefined : pages.find((p) => p.id === value);
  const chosenPath = chosen ? [pathOf(chosen), pageTitle(chosen)].filter(Boolean).join(" › ") : "";

  // Die gewählte Zeile mittig in die Liste holen, sobald die Seiten da sind (nur beim ersten Mal)
  const scrolled = useRef(false);
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(".dp-row.selected");
    if (!loaded || scrolled.current || !list || !row) return;
    scrolled.current = true;
    list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2);
  }, [loaded, pages]);

  const button = (page: DocPage, depth: number, showPath: boolean) => {
    const selected = page.id === value;
    const path = showPath ? pathOf(page) : "";
    return (
      <button
        type="button"
        className={`dp-row${selected ? " selected" : ""}`}
        style={showPath ? undefined : { paddingLeft: `${0.65 + depth}rem` }}
        aria-pressed={selected}
        onClick={() => onChange(selected ? null : page.id)}
      >
        {isFolder(page) ? <Folder size={14} /> : <FileText size={14} />}
        <span>{pageTitle(page)}</span>
        {path && <small className="dp-path">{path}</small>}
        {selected && <Check size={14} className="dp-check" />}
      </button>
    );
  };

  const row = (node: DocNode, depth: number) => (
    <li key={node.page.id}>
      {button(node.page, depth, false)}
      {node.children.length > 0 && <ul>{node.children.map((c) => row(c, depth + 1))}</ul>}
    </li>
  );

  const matches = q ? pages.filter((p) => pageTitle(p).toLowerCase().includes(q)) : [];

  return (
    <div className="dpick">
      {chosen && (
        <div className="dpick-value">
          {isFolder(chosen) ? <Folder size={14} /> : <FileText size={14} />}
          <span title={chosenPath}>{chosenPath}</span>
          <button type="button" className="icon-btn" aria-label="Zuordnung entfernen" title="Zuordnung entfernen" onClick={() => onChange(null)}>
            <X size={13} />
          </button>
        </div>
      )}
      {pages.length >= SEARCH_FROM && (
        <label className="dpick-search">
          <Search size={14} />
          <input value={query} placeholder="Suchen …" aria-label="Dokumentation durchsuchen" onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      <div className="dpick-list" ref={listRef} role="group" aria-label="Dokumentation">
        {!loaded ? null : pages.length === 0 ? (
          <p className="dpick-empty">Noch keine Seiten</p>
        ) : q ? (
          <ul>
            {matches.length === 0 && <li className="dpick-none">Nichts gefunden</li>}
            {matches.map((p) => (
              <li key={p.id}>{button(p, 0, true)}</li>
            ))}
          </ul>
        ) : (
          <ul>{tree.map((n) => row(n, 0))}</ul>
        )}
      </div>
    </div>
  );
}
