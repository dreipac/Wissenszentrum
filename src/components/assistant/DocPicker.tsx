import { useMemo, useState } from "react";
import { BookOpen, Check, FileText, Folder, Search } from "lucide-react";
import { buildTree, isFolder, pageTitle, type DocNode } from "../../lib/docs";
import { useDocs } from "../../lib/useDocs";
import "./Projects.css";

interface DocPickerProps {
  /** Gewählter Ordner oder gewählte Seite (null = keine) */
  value: number | null;
  onChange: (id: number | null) => void;
}

const SEARCH_FROM = 10;

/** Auswahl eines Ordners oder einer Seite der Dokumentation als Baum, bei vielen Einträgen mit Suche. */
export function DocPicker({ value, onChange }: DocPickerProps) {
  const { pages, loaded } = useDocs();
  const [query, setQuery] = useState("");
  const tree = useMemo(() => buildTree(pages), [pages]);
  const q = query.trim().toLowerCase();

  const row = (node: DocNode, depth: number) => {
    const selected = node.page.id === value;
    return (
      <li key={node.page.id}>
        <button
          type="button"
          className={`dp-row${selected ? " selected" : ""}`}
          style={{ paddingLeft: `${0.65 + depth * 1}rem` }}
          aria-pressed={selected}
          onClick={() => onChange(selected ? null : node.page.id)}
        >
          {isFolder(node.page) ? <Folder size={14} /> : <FileText size={14} />}
          <span>{pageTitle(node.page)}</span>
          {selected && <Check size={14} className="dp-check" />}
        </button>
        {node.children.length > 0 && <ul>{node.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };

  const matches = q ? pages.filter((p) => pageTitle(p).toLowerCase().includes(q)) : [];

  return (
    <div className="dpick">
      {pages.length >= SEARCH_FROM && (
        <label className="dpick-search">
          <Search size={14} />
          <input value={query} placeholder="Ordner oder Seite suchen …" aria-label="Dokumentation durchsuchen" onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}
      <div className="dpick-list" role="group" aria-label="Dokumentation">
        {!loaded ? null : pages.length === 0 ? (
          <p className="dpick-empty">
            <BookOpen size={15} />
            In der Dokumentation gibt es noch nichts.
          </p>
        ) : q ? (
          <ul>
            {matches.length === 0 && <li className="dpick-none">Nichts gefunden.</li>}
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" className={`dp-row${p.id === value ? " selected" : ""}`} aria-pressed={p.id === value} onClick={() => onChange(p.id === value ? null : p.id)}>
                  {isFolder(p) ? <Folder size={14} /> : <FileText size={14} />}
                  <span>{pageTitle(p)}</span>
                  {p.id === value && <Check size={14} className="dp-check" />}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul>{tree.map((n) => row(n, 0))}</ul>
        )}
      </div>
    </div>
  );
}
