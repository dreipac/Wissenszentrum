import { useState } from "react";
import {
  Bold,
  CheckSquare,
  Code,
  Folder,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  MoreHorizontal,
  Pin,
  Plus,
  Quote,
  Search,
  Share2,
} from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { notes } from "../data/mock";
import "./NotesView.css";

const folders = ["Alle", "Ideen", "Meetings", "IT", "Lernen", "Privat"];

export function NotesView() {
  const [folder, setFolder] = useState("Alle");
  const [selectedId, setSelectedId] = useState(notes[0].id);

  const list = notes.filter((n) => folder === "Alle" || n.folder === folder);
  const current = notes.find((n) => n.id === selectedId) ?? notes[0];

  return (
    <div className="notes-layout">
      <section className="notes-list-pane">
        <header className="notes-list-head">
          <div className="page-title-row">
            <h1 className="page-title">Notizen</h1>
            <Button className="sm">
              <Plus size={14} />
              Neu
            </Button>
          </div>
          <label className="input notes-search">
            <Search size={14} />
            <input placeholder="Notizen durchsuchen …" />
          </label>
          <div className="notes-folders">
            {folders.map((f) => (
              <button
                key={f}
                type="button"
                className={`notes-folder${folder === f ? " active" : ""}`}
                onClick={() => setFolder(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </header>

        <ul className="notes-list">
          {list.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`note-item${n.id === current.id ? " active" : ""}`}
                onClick={() => setSelectedId(n.id)}
              >
                <div className="note-item-top">
                  <span className="note-item-title">{n.title}</span>
                  {n.pinned && <Pin size={12} className="note-pin" />}
                </div>
                <span className="note-item-preview">{n.preview}</span>
                <div className="note-item-meta">
                  <span className="note-item-folder">
                    <Folder size={11} />
                    {n.folder}
                  </span>
                  <span>{n.updated}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="note-editor-pane">
        <header className="note-editor-head">
          <div className="note-editor-meta">
            <span className="tag">
              <Folder size={11} style={{ marginRight: 4 }} />
              {current.folder}
            </span>
            <span className="muted note-saved">Zuletzt bearbeitet: {current.updated}</span>
          </div>
          <div className="page-actions">
            <SecondaryButton className="sm">
              <Share2 size={14} />
              Teilen
            </SecondaryButton>
            <button type="button" className="icon-btn" aria-label="Mehr">
              <MoreHorizontal size={16} />
            </button>
          </div>
        </header>

        <div className="note-toolbar">
          <button type="button" className="icon-btn" aria-label="Fett"><Bold size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Kursiv"><Italic size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Überschrift"><Heading2 size={15} /></button>
          <span className="note-toolbar-sep" />
          <button type="button" className="icon-btn" aria-label="Liste"><List size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Nummerierte Liste"><ListOrdered size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Checkliste"><CheckSquare size={15} /></button>
          <span className="note-toolbar-sep" />
          <button type="button" className="icon-btn" aria-label="Zitat"><Quote size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Code"><Code size={15} /></button>
          <button type="button" className="icon-btn" aria-label="Link"><Link2 size={15} /></button>
        </div>

        <div className="note-editor-scroll">
          <article className="note-article">
            <h1 className="note-title">{current.title}</h1>
            <p>
              Das Wissenszentrum soll die zentrale Stelle für alle Aufgaben, Notizen, Termine und
              Dokumentationen werden – lokal, schnell und übersichtlich.
            </p>
            <h2>Kernbereiche</h2>
            <ul>
              <li>Aufgaben mit optionalen Buckets (Board- und Listenansicht)</li>
              <li>Kalender mit Terminen und Fristen</li>
              <li>Notizen mit Ordnern und schnellem Suchen</li>
              <li>Dokumentation als verschachtelte Seiten</li>
            </ul>
            <h2>Nächste Schritte</h2>
            <ul className="note-checklist">
              <li><span className="check checked" /> Layout und Design-System festlegen</li>
              <li><span className="check" /> Datenmodell definieren (SQLite)</li>
              <li><span className="check" /> Aufgaben-Modul umsetzen</li>
            </ul>
            <blockquote>Erst das Layout sauber, dann die Funktionen.</blockquote>
          </article>
        </div>
      </section>
    </div>
  );
}
