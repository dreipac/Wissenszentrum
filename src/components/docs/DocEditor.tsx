import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { ChevronRight, FileText, FolderClosed } from "lucide-react";
import { updateDocPage } from "../../lib/api/docs";
import { isEmptyPage, isFolder, pageTitle, type DocPage } from "../../lib/docs";
import { formatNoteTime } from "../../lib/notes";
import { DocToolbar } from "./DocToolbar";
import { TableBar } from "./TableBar";

const AUTOSAVE_MS = 600;

interface OutlineItem {
  level: number;
  text: string;
  pos: number;
}

function readOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading" && node.textContent.trim()) items.push({ level: node.attrs.level as number, text: node.textContent, pos });
  });
  return items;
}

interface DocEditorProps {
  page: DocPage;
  /** true = bearbeiten, false = lesen */
  editing: boolean;
  onEdit: () => void;
  /** Unterseiten dieser Seite, werden unter dem Text aufgelistet */
  subpages: DocPage[];
  onOpen: (id: number) => void;
}

/**
 * Inhalt einer Seite: Titel, Text und Gliederung. Im Lesemodus ist alles gesperrt, im Bearbeitungsmodus
 * speichert der Editor automatisch kurz nach dem Tippen. Der lokale Zustand gehört dem Editor: Änderungen der
 * Seitenliste überschreiben nichts, während man schreibt. Pro Seite neu einsetzen (`key={page.id}`).
 */
export function DocEditor({ page, editing, onEdit, subpages, onOpen }: DocEditorProps) {
  const [title, setTitle] = useState(page.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [empty, setEmpty] = useState(isEmptyPage(page));

  const draft = useRef({ title: page.title, content: page.content, plain: page.plain });
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const titleRef = useRef<HTMLInputElement>(null);
  const articleRef = useRef<HTMLElement>(null);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setSaving(true);
    try {
      await updateDocPage(page.id, { ...draft.current });
      setError(null);
    } catch (e) {
      dirty.current = true;
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [page.id]);

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
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder: "Schreibe hier die Dokumentation …" }),
    ],
    content: page.content,
    editable: editing,
    // Klasse note-prose liefert die Grundgestaltung (Listen, Zitate, Code), doc-prose ergänzt Tabellen und Größen
    editorProps: { attributes: { class: "note-prose doc-prose", spellcheck: "true" } },
    onCreate: ({ editor }) => setOutline(readOutline(editor)),
    onUpdate: ({ editor }) => {
      draft.current.content = editor.getHTML();
      draft.current.plain = editor.getText({ blockSeparator: "\n" });
      setOutline(readOutline(editor));
      setEmpty(draft.current.plain.trim() === "");
      schedule();
    },
  });

  // Lesen/Bearbeiten umschalten; beim Verlassen des Bearbeitens sofort speichern
  useEffect(() => {
    editor?.setEditable(editing);
    if (editing) {
      if (!page.title && !page.plain) titleRef.current?.focus();
    } else {
      void save();
    }
    // Titelfokus nur beim Wechsel in den Bearbeitungsmodus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, editor]);

  // Beim Verlassen der Seite und wenn das Fenster den Fokus verliert: ausstehende Änderungen sofort speichern
  useEffect(() => {
    const flush = () => void save();
    window.addEventListener("blur", flush);
    return () => {
      window.removeEventListener("blur", flush);
      flush();
    };
  }, [save]);

  const onTitle = (value: string) => {
    setTitle(value);
    draft.current.title = value;
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

  const goTo = (pos: number) => {
    const dom = editor?.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) dom.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const status = error ? "Speichern fehlgeschlagen" : saving ? "Speichert …" : `Zuletzt bearbeitet ${formatNoteTime(page.updatedAt)}`;

  return (
    <div className="doc-body">
      {editing && (
        <>
          <DocToolbar editor={editor} linkOpen={linkOpen} onLink={openLink} />

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
        </>
      )}

      <div className="docs-scroll" onClick={(e) => editing && e.target === e.currentTarget && editor?.commands.focus("end")}>
        <article ref={articleRef} className="doc-article">
          <input
            ref={titleRef}
            className="doc-title-input"
            value={title}
            readOnly={!editing}
            placeholder="Titel der Seite"
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
          <div className="doc-meta">
            <span className={`doc-status${error ? " error" : ""}`} title={error ?? undefined}>
              {status}
            </span>
            <span className="doc-meta-dot">·</span>
            <span>Erstellt {formatNoteTime(page.createdAt)}</span>
          </div>

          <EditorContent editor={editor} />
          <TableBar editor={editor} anchor={articleRef} />

          {!editing && empty && (
            <div className="doc-empty">
              <p className="muted">Diese Seite ist noch leer.</p>
              <button type="button" className="btn-secondary sm" onClick={onEdit}>
                Jetzt schreiben
              </button>
            </div>
          )}

          {subpages.length > 0 && (
            <section className="doc-subpages" aria-label="Unterseiten">
              <span className="card-title">Unterseiten</span>
              <ul>
                {subpages.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => onOpen(s.id)}>
                      {isFolder(s) ? <FolderClosed size={15} /> : <FileText size={15} />}
                      <span>{pageTitle(s)}</span>
                      <ChevronRight size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>

        {outline.length > 0 && (
          <aside className="doc-outline" aria-label="Auf dieser Seite">
            <span className="card-title">Auf dieser Seite</span>
            {outline.map((o) => (
              <button key={o.pos} type="button" className="doc-outline-item" style={{ paddingLeft: `${(o.level - Math.min(...outline.map((x) => x.level))) * 0.7}rem` }} onClick={() => goTo(o.pos)}>
                {o.text}
              </button>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
