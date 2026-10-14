import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
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
  Quote,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ContextMenu } from "../ui/ContextMenu";
import { deleteNote, setNotePinned, updateNote } from "../../lib/api/notes";
import { formatNoteTime, noteTitle, type Note } from "../../lib/notes";

const AUTOSAVE_MS = 600;

interface ToolButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
}

function ToolButton({ icon: Icon, label, active, onClick }: ToolButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn${active ? " active" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      // mousedown verhindern, damit der Editor seine Textauswahl behält
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon size={15} />
    </button>
  );
}

interface NoteEditorProps {
  note: Note;
  /** Vorhandene Ordner als Vorschläge im Ordner-Feld */
  folders: string[];
}

/**
 * Editor einer Notiz. Speichert automatisch kurz nach dem Tippen. Der lokale Zustand gehört dem
 * Editor: Änderungen der Notizliste überschreiben nichts, während man schreibt. Pro Notiz neu
 * einsetzen (`key={note.id}`).
 */
export function NoteEditor({ note, folders }: NoteEditorProps) {
  const [title, setTitle] = useState(note.title);
  const [folder, setFolder] = useState(note.folder);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Aktueller Stand für das Speichern (unabhängig vom Render-Zyklus und vom Editor, der beim Verlassen schon weg sein kann)
  const draft = useRef({ title: note.title, folder: note.folder, content: note.content, plain: note.plain });
  const dirty = useRef(false);
  const deleted = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const titleRef = useRef<HTMLInputElement>(null);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current || deleted.current) return;
    dirty.current = false;
    setSaving(true);
    try {
      await updateNote(note.id, { ...draft.current });
      setError(null);
    } catch (e) {
      dirty.current = true;
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [note.id]);

  const schedule = useCallback(() => {
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }, [save]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Notiz schreiben …" }),
    ],
    content: note.content,
    editorProps: { attributes: { class: "note-prose", spellcheck: "true" } },
    onUpdate: ({ editor }) => {
      draft.current.content = editor.getHTML();
      draft.current.plain = editor.getText({ blockSeparator: "\n" });
      schedule();
    },
  });

  // Beim Verlassen der Notiz und wenn das Fenster den Fokus verliert: ausstehende Änderungen sofort speichern
  useEffect(() => {
    const flush = () => void save();
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("blur", flush);
      flush();
    };
  }, [save]);

  // Frisch angelegte, leere Notiz: Cursor direkt in den Titel
  useEffect(() => {
    if (!note.title && !note.plain) titleRef.current?.focus();
    // nur beim Öffnen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            heading: e.isActive("heading", { level: 2 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            task: e.isActive("taskList"),
            quote: e.isActive("blockquote"),
            code: e.isActive("code"),
            link: e.isActive("link"),
          }
        : null,
  });

  const onTitle = (value: string) => {
    setTitle(value);
    draft.current.title = value;
    schedule();
  };
  const onFolder = (value: string) => {
    setFolder(value);
    draft.current.folder = value;
    schedule();
  };

  const openLink = () => {
    if (!editor) return;
    setLinkUrl(editor.getAttributes("link").href ?? "");
    setLinkOpen((open) => !open);
  };
  const applyLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    const url = linkUrl.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!url) chain.unsetLink().run();
    else chain.setLink({ href: /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}` }).run();
    setLinkOpen(false);
  };

  const remove = async () => {
    deleted.current = true;
    window.clearTimeout(timer.current);
    try {
      await deleteNote(note.id);
    } catch (e) {
      deleted.current = false;
      setConfirmDelete(false);
      setError(String(e));
    }
  };

  const status = error ? "Speichern fehlgeschlagen" : saving ? "Speichert …" : `Zuletzt bearbeitet: ${formatNoteTime(note.updatedAt)}`;

  return (
    <section className="note-editor-pane">
      <header className="note-editor-head">
        <div className="note-editor-meta">
          <label className="tag note-folder-field" title="Ordner">
            <Folder size={11} />
            <input
              list="note-folder-list"
              value={folder}
              maxLength={40}
              placeholder="Ohne Ordner"
              aria-label="Ordner"
              onChange={(e) => onFolder(e.target.value)}
            />
          </label>
          <datalist id="note-folder-list">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <span className={`muted note-saved${error ? " error" : ""}`} title={error ?? undefined}>
            {status}
          </span>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className={`icon-btn${note.pinned ? " active" : ""}`}
            aria-label={note.pinned ? "Nicht mehr anpinnen" : "Anpinnen"}
            title={note.pinned ? "Nicht mehr anpinnen" : "Anpinnen"}
            aria-pressed={note.pinned}
            onClick={() => void setNotePinned(note.id, !note.pinned)}
          >
            <Pin size={16} fill={note.pinned ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Mehr"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.right - 180, y: r.bottom + 4 });
            }}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </header>

      <div className="note-toolbar">
        <ToolButton icon={Bold} label="Fett" active={active?.bold} onClick={() => editor?.chain().focus().toggleBold().run()} />
        <ToolButton icon={Italic} label="Kursiv" active={active?.italic} onClick={() => editor?.chain().focus().toggleItalic().run()} />
        <ToolButton icon={Heading2} label="Überschrift" active={active?.heading} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
        <span className="note-toolbar-sep" />
        <ToolButton icon={List} label="Liste" active={active?.bullet} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
        <ToolButton icon={ListOrdered} label="Nummerierte Liste" active={active?.ordered} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
        <ToolButton icon={CheckSquare} label="Checkliste" active={active?.task} onClick={() => editor?.chain().focus().toggleTaskList().run()} />
        <span className="note-toolbar-sep" />
        <ToolButton icon={Quote} label="Zitat" active={active?.quote} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
        <ToolButton icon={Code} label="Code" active={active?.code} onClick={() => editor?.chain().focus().toggleCode().run()} />
        <ToolButton icon={Link2} label="Link" active={active?.link || linkOpen} onClick={openLink} />
      </div>

      {linkOpen && (
        <form className="note-linkbar" onSubmit={applyLink}>
          <input
            autoFocus
            value={linkUrl}
            placeholder="Adresse einfügen und Enter drücken (leer = Link entfernen)"
            aria-label="Link-Adresse"
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLinkOpen(false)}
          />
        </form>
      )}

      <div
        className="note-editor-scroll"
        onClick={(e) => e.target === e.currentTarget && editor?.commands.focus("end")}
      >
        <article className="note-article">
          <input
            ref={titleRef}
            className="note-title-input"
            value={title}
            placeholder="Titel"
            aria-label="Titel"
            maxLength={200}
            onChange={(e) => onTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
          />
          <EditorContent editor={editor} />
        </article>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[{ label: "Notiz löschen", icon: Trash2, onClick: () => setConfirmDelete(true) }]}
          onClose={() => setMenu(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Notiz löschen?"
          message={`„${noteTitle({ title })}“ wird dauerhaft gelöscht.`}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </section>
  );
}
