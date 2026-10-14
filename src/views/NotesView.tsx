import { useEffect, useMemo, useState } from "react";
import { Folder, NotebookText, Pin, Plus, Search } from "lucide-react";
import { Button } from "../components/ui/Button";
import { NoteEditor } from "../components/notes/NoteEditor";
import { createNote, purgeEmptyNotes } from "../lib/api/notes";
import { emptyNote, formatNoteTime, isEmptyNote, noteTitle, notePreview } from "../lib/notes";
import { clearPendingNote, onOpenNoteRequest, peekPendingNote } from "../lib/notesNav";
import { useNotes } from "../lib/useNotes";
import "./NotesView.css";

const ALL = "__all";
const NONE = "__none";

export function NotesView() {
  const { notes, loaded, error } = useNotes();
  const [folder, setFolder] = useState(ALL);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(() => peekPendingNote());
  const [createError, setCreateError] = useState<string | null>(null);

  // Beim Öffnen leere Notizen aufräumen (außer einer gerade angelegten) und Wünsche „Notiz öffnen“ entgegennehmen
  useEffect(() => {
    const pending = peekPendingNote();
    void purgeEmptyNotes(pending)
      .catch(() => undefined)
      .finally(clearPendingNote);

    return onOpenNoteRequest(() => {
      const id = peekPendingNote();
      clearPendingNote();
      if (id === null) return;
      setSelectedId(id);
      setFolder(ALL);
      setQuery("");
    });
  }, []);

  const folders = useMemo(
    () => [...new Set(notes.map((n) => n.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")),
    [notes],
  );
  const hasLoose = notes.some((n) => !n.folder);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter(
      (n) =>
        (folder === ALL || (folder === NONE ? !n.folder : n.folder === folder)) &&
        (!q || n.title.toLowerCase().includes(q) || n.plain.toLowerCase().includes(q) || n.folder.toLowerCase().includes(q)),
    );
  }, [notes, folder, query]);

  // Ein Ordner, der nach dem Löschen/Umbenennen nicht mehr existiert, soll nicht „hängen bleiben“
  useEffect(() => {
    if (loaded && folder !== ALL && folder !== NONE && !folders.includes(folder)) setFolder(ALL);
  }, [loaded, folder, folders]);

  const current = filtered.find((n) => n.id === selectedId) ?? filtered[0] ?? null;

  const addNote = async () => {
    // Eine noch leere Notiz wiederverwenden statt eine zweite anzulegen
    if (current && isEmptyNote(current)) return setSelectedId(current.id);
    setCreateError(null);
    try {
      const note = await createNote(emptyNote(folder !== ALL && folder !== NONE ? folder : ""));
      setSelectedId(note.id);
      setQuery("");
    } catch (e) {
      setCreateError(String(e));
    }
  };

  const chips = [
    { id: ALL, label: "Alle" },
    ...folders.map((f) => ({ id: f, label: f })),
    ...(folders.length > 0 && hasLoose ? [{ id: NONE, label: "Ohne Ordner" }] : []),
  ];

  return (
    <div className="notes-layout">
      <section className="notes-list-pane">
        <header className="notes-list-head">
          <div className="page-title-row">
            <h1 className="page-title">Notizen</h1>
            <Button className="sm" onClick={() => void addNote()}>
              <Plus size={14} />
              Neu
            </Button>
          </div>
          <label className="input notes-search">
            <Search size={14} />
            <input placeholder="Notizen durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {chips.length > 1 && (
            <div className="notes-folders">
              {chips.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`notes-folder${folder === c.id ? " active" : ""}`}
                  onClick={() => setFolder(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {(error || createError) && <p className="field-error">{error ?? createError}</p>}
        </header>

        <ul className="notes-list">
          {filtered.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`note-item${n.id === current?.id ? " active" : ""}`}
                onClick={() => setSelectedId(n.id)}
              >
                <div className="note-item-top">
                  <span className={`note-item-title${n.title.trim() ? "" : " untitled"}`}>{noteTitle(n)}</span>
                  {n.pinned && <Pin size={12} className="note-pin" />}
                </div>
                <span className="note-item-preview">{notePreview(n) || "Kein weiterer Text"}</span>
                <div className="note-item-meta">
                  <span className="note-item-folder">
                    {n.folder && (
                      <>
                        <Folder size={11} />
                        {n.folder}
                      </>
                    )}
                  </span>
                  <span>{formatNoteTime(n.updatedAt)}</span>
                </div>
              </button>
            </li>
          ))}
          {loaded && filtered.length === 0 && (
            <li className="notes-empty muted">{notes.length === 0 ? "Noch keine Notizen." : "Keine Notizen gefunden."}</li>
          )}
        </ul>
      </section>

      {current ? (
        <NoteEditor key={current.id} note={current} folders={folders} />
      ) : (
        loaded && (
          <section className="note-editor-pane note-empty-pane">
            <NotebookText size={30} />
            <h2>Keine Notiz ausgewählt</h2>
            <p>Halte Gedanken, Mitschriften und Ideen schnell fest. Gespeichert wird automatisch.</p>
            <Button onClick={() => void addNote()}>
              <Plus size={16} />
              Neue Notiz
            </Button>
          </section>
        )
      )}
    </div>
  );
}
