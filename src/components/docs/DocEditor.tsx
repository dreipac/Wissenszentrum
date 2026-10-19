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
import { addDocImage } from "../../lib/api/docImages";
import { prepareImage } from "../../lib/imageProcess";
import { useEditorTheme } from "../../lib/editorTheme";
import { attachFiles, otherFiles } from "../../lib/attachFiles";
import { FileAttachment } from "../files/FileAttachment";
import { DocImage } from "./DocImage";
import { SizedTableRow } from "./SizedTableRow";
import { TextSize } from "./TextSize";
import { DocToolbar } from "./DocToolbar";
import { NodeBar } from "./NodeBar";
import { TableHandle } from "./TableHandle";
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

/** Nur die Bilddateien aus einer Dateiliste. */
const imageFiles = (list: FileList | null | undefined): File[] => [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

interface DocEditorProps {
  page: DocPage;
  /** true = bearbeiten, false = lesen */
  editing: boolean;
  /** Unterseiten dieser Seite, werden unter dem Text aufgelistet */
  subpages: DocPage[];
  onOpen: (id: number) => void;
}

/**
 * Inhalt einer Seite: Titel, Text und Gliederung. Im Lesemodus ist alles gesperrt, im Bearbeitungsmodus
 * speichert der Editor automatisch kurz nach dem Tippen. Der lokale Zustand gehört dem Editor: Änderungen der
 * Seitenliste überschreiben nichts, während man schreibt. Pro Seite neu einsetzen (`key={page.id}`).
 */
export function DocEditor({ page, editing, subpages, onOpen }: DocEditorProps) {
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
  const fileInput = useRef<HTMLInputElement>(null);
  const anyFileInput = useRef<HTMLInputElement>(null);
  const insertAttachments = useRef<(files: File[], pos?: number) => void>(() => undefined);
  const [tableMoving, setTableMoving] = useState(false);
  const insertImages = useRef<(files: File[], pos?: number) => void>(() => undefined);
  const [imageError, setImageError] = useState<string | null>(null);

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
      // Spaltenbreite lässt sich an den Trennlinien mit der Maus ziehen
      TableKit.configure({ table: { resizable: true, cellMinWidth: 60, handleWidth: 6 }, tableRow: false }),
      SizedTableRow,
      TextSize,
      DocImage,
      FileAttachment,
      Placeholder.configure({ placeholder: "Schreibe hier die Dokumentation …" }),
    ],
    content: page.content,
    // Immer bearbeitbar erzeugen: die Tabellenerweiterung richtet das Ziehen der Spaltenbreite nur dann ein; der Lesemodus
    // wird gleich danach gesetzt (siehe unten) und sperrt das Ziehen wieder
    editable: true,
    // Klasse note-prose liefert die Grundgestaltung (Listen, Zitate, Code), doc-prose ergänzt Tabellen und Größen
    editorProps: {
      attributes: { class: "note-prose doc-prose", spellcheck: "true" },
      // Beim Schreiben hält der Editor die Schreibzeile deutlich über dem unteren Rand, statt sie dort kleben zu lassen
      scrollThreshold: { top: 80, right: 0, bottom: 240, left: 0 },
      scrollMargin: { top: 80, right: 0, bottom: 240, left: 0 },
      // Bilder und andere Dateien aus der Zwischenablage oder per Drag & Drop einfügen
      handlePaste: (_view, event) => {
        const images = imageFiles(event.clipboardData?.files);
        const others = otherFiles(event.clipboardData?.files);
        if (images.length === 0 && others.length === 0) return false;
        event.preventDefault();
        if (images.length) insertImages.current(images);
        if (others.length) insertAttachments.current(others);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        // Verschobene Bilder und Texte übernimmt der Editor selbst, auch in Tabellenzellen hinein
        if (moved) return false;
        const images = imageFiles(event.dataTransfer?.files);
        const others = otherFiles(event.dataTransfer?.files);
        if (images.length === 0 && others.length === 0) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (images.length) insertImages.current(images, at);
        if (others.length) insertAttachments.current(others, at);
        return true;
      },
    },
    onCreate: ({ editor }) => setOutline(readOutline(editor)),
    onUpdate: ({ editor }) => {
      draft.current.content = editor.getHTML();
      draft.current.plain = editor.getText({ blockSeparator: "\n" });
      setOutline(readOutline(editor));
      setEmpty(draft.current.plain.trim() === "");
      schedule();
    },
  });

  // Bilder verkleinern, speichern und an der Stelle einfügen (Cursor, Ablageort oder Ende)
  insertImages.current = (files, pos) => {
    if (!editor) return;
    setImageError(null);
    void (async () => {
      for (const file of files) {
        try {
          const prepared = await prepareImage(file);
          const imageId = await addDocImage(prepared.blob, prepared.mime);
          const attrs = { imageId, width: Math.min(prepared.width, 560) };
          if (pos !== undefined) editor.chain().focus().insertContentAt(pos, { type: "docImage", attrs }).run();
          else editor.chain().focus().insertDocImage(attrs).run();
        } catch (e) {
          setImageError(String(e));
        }
      }
    })();
  };

  // Dateien speichern und als Karten einfügen
  insertAttachments.current = (files, pos) => {
    if (!editor) return;
    setImageError(null);
    void attachFiles(editor, files, pos).then((message) => message && setImageError(message));
  };

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

  const { theme: editorTheme } = useEditorTheme();
  const status = imageError ?? (error ? "Speichern fehlgeschlagen" : saving ? "Speichert …" : `Zuletzt bearbeitet ${formatNoteTime(page.updatedAt)}`);

  return (
    <div className="doc-body">
      {editing && (
        <>
          <DocToolbar editor={editor} linkOpen={linkOpen} onLink={openLink} onImage={() => fileInput.current?.click()} onFile={() => anyFileInput.current?.click()} />

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

      <div className="docs-scroll" data-editor-theme={editorTheme} onClick={(e) => editing && e.target === e.currentTarget && editor?.commands.focus("end")}>
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
          <TableBar editor={editor} anchor={articleRef} hidden={tableMoving} />
          <NodeBar editor={editor} anchor={articleRef} />
          <TableHandle editor={editor} anchor={articleRef} onMoving={setTableMoving} />
          {editing && (
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                insertImages.current(imageFiles(e.target.files));
                e.target.value = "";
              }}
            />
          )}
          {editing && (
            <input
              ref={anyFileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                insertAttachments.current([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          )}

          {!editing && empty && (
            <p className="muted doc-empty">Diese Seite ist noch leer.</p>
          )}

          {subpages.length > 0 && (
            <section className="doc-subpages" aria-label="Unterseiten">
              <span className="card-title">Unterseiten</span>
              <ul className="doc-list">
                {subpages.map((s) => (
                  <li key={s.id}>
                    <button type="button" className="doc-row" onClick={() => onOpen(s.id)}>
                      {isFolder(s) ? <FolderClosed size={16} /> : <FileText size={16} />}
                      <span className="doc-row-title">{pageTitle(s)}</span>
                      <span className="doc-row-meta">Bearbeitet {formatNoteTime(s.updatedAt)}</span>
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
