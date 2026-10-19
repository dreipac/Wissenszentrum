import { useEffect, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState, type NodeViewProps } from "@tiptap/react";
import { Download, File, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Presentation, X, type LucideIcon } from "lucide-react";
import { openAttachment, saveAttachmentAs } from "../../lib/api/attachments";
import "./FileAttachment.css";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileAttachment: {
      insertFileAttachment: (attrs: { fileId: number; name: string; size: number; mime: string }) => ReturnType;
    };
  }
}

/** Schmaler als das lässt sich die Karte nicht ziehen */
const MIN_WIDTH = 180;

type Tone = "red" | "blue" | "green" | "amber" | "purple" | "gray";

/** Symbol und Farbton nach Dateityp (Endung, sonst MIME-Typ). */
function kindOf(name: string, mime: string): { icon: LucideIcon; tone: Tone; label: string } {
  const ext = (name.split(".").length > 1 ? name.split(".").pop() ?? "" : "").toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") return { icon: FileText, tone: "red", label: "PDF" };
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return { icon: FileText, tone: "blue", label: ext.toUpperCase() };
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return { icon: FileSpreadsheet, tone: "green", label: ext.toUpperCase() };
  if (["ppt", "pptx", "odp", "key"].includes(ext)) return { icon: Presentation, tone: "amber", label: ext.toUpperCase() };
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return { icon: FileArchive, tone: "purple", label: ext.toUpperCase() };
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return { icon: FileImage, tone: "purple", label: ext.toUpperCase() || "Bild" };
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "flac"].includes(ext)) return { icon: FileAudio, tone: "amber", label: ext.toUpperCase() || "Audio" };
  if (mime.startsWith("video/") || ["mp4", "mov", "mkv", "avi"].includes(ext)) return { icon: FileVideo, tone: "blue", label: ext.toUpperCase() || "Video" };
  if (["txt", "md", "log"].includes(ext) || mime.startsWith("text/")) return { icon: FileText, tone: "gray", label: ext.toUpperCase() || "Text" };
  return { icon: File, tone: "gray", label: ext ? ext.toUpperCase() : "Datei" };
}

/** 1.2 MB, 340 KB */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toLocaleString("de-CH", { maximumFractionDigits: 1 })} MB`;
}

function FileCard({ node, deleteNode, updateAttributes, editor, selected }: NodeViewProps) {
  const { fileId, name, size, mime, width } = node.attrs as { fileId: number; name: string; size: number; mime: string; width: number | null };
  const { icon: Icon, tone } = kindOf(name, mime);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Beim Ziehen am rechten Rand gilt die vorläufige Breite; erst beim Loslassen wird sie gespeichert
  const [live, setLive] = useState<number | null>(null);
  const card = useRef<HTMLElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  // Der Lese-/Bearbeitungsmodus wechselt, ohne dass der Knoten neu entsteht: darum mitlesen
  const editable = useEditorState({ editor, selector: ({ editor: e }) => e.isEditable });

  useEffect(() => {
    const el = edge.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    el.addEventListener("dragstart", (e) => e.preventDefault());
    return () => el.removeEventListener("mousedown", stop);
  }, [editable]);

  /** Breite per Maus am rechten Rand ändern: ziehen verkürzt oder verlängert die Karte. */
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !card.current) return;
    e.preventDefault();
    const handle = e.currentTarget;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      /* Zeiger nicht mehr aktiv */
    }
    const startX = e.clientX;
    const startWidth = card.current.getBoundingClientRect().width;
    const limit = card.current.parentElement?.getBoundingClientRect().width ?? 800;
    let next = startWidth;
    const move = (ev: PointerEvent) => {
      next = Math.round(Math.min(Math.max(startWidth + ev.clientX - startX, MIN_WIDTH), limit));
      setLive(next);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setLive(null);
      if (next !== Math.round(startWidth)) updateAttributes({ width: next });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <NodeViewWrapper
      ref={card}
      className={`file-card${selected ? " selected" : ""}`}
      style={{ whiteSpace: "normal", ...(live ?? width ? { width: live ?? width ?? undefined, maxWidth: "100%" } : {}) }}
      data-drag-handle
    >
      <div className="file-card-row" contentEditable={false}>
        {/* Bewusst kein <button>: der Editor reicht Mausklicks auf Schaltflächen nicht an sich weiter, die Karte ließe sich dann nicht ziehen */}
        <div
          role="button"
          tabIndex={0}
          className={`file-card-main${busy ? " busy" : ""}`}
          title="Doppelklick zum Öffnen"
          onDoubleClick={() => !busy && void run(() => openAttachment(fileId))}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (!busy) void run(() => openAttachment(fileId));
            }
          }}
        >
          <Icon size={17} className={`file-card-icon ${tone}`} />
          <span className="file-card-name">{name}</span>
          <span className="file-card-size">{formatBytes(size)}</span>
        </div>
        <span className="file-card-actions">
          <button type="button" className="icon-btn" aria-label="Speichern unter" title="Speichern unter" disabled={busy} onClick={() => void run(() => saveAttachmentAs(fileId, name))}>
            <Download size={15} />
          </button>
          {editable && (
            <button type="button" className="icon-btn" aria-label="Aus dem Text entfernen" title="Aus dem Text entfernen" onClick={() => deleteNode()}>
              <X size={15} />
            </button>
          )}
        </span>
        {editable && (
          <div ref={edge} className="file-card-edge" title="Breite ziehen" onPointerDown={startResize} contentEditable={false} />
        )}
      </div>
      {error && (
        <p className="file-card-error" contentEditable={false}>
          {error}
        </p>
      )}
    </NodeViewWrapper>
  );
}

/**
 * Dateianhang als Karte im Text. Im Text steht nur die ID (<div data-file-id="7" data-name="…">), die Bytes liegen in
 * der Datenbank. Ein Klick öffnet die Datei mit dem Standardprogramm, „Speichern unter“ legt sie an einem Ort ab.
 */
export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      fileId: { default: 0, parseHTML: (el) => Number(el.getAttribute("data-file-id")), renderHTML: (a) => ({ "data-file-id": a.fileId }) },
      name: { default: "Datei", parseHTML: (el) => el.getAttribute("data-name") || "Datei", renderHTML: (a) => ({ "data-name": a.name }) },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute("data-size")) || 0, renderHTML: (a) => ({ "data-size": a.size }) },
      width: { default: null, parseHTML: (el) => (el.getAttribute("data-width") ? Number(el.getAttribute("data-width")) : null), renderHTML: (a) => (a.width ? { "data-width": a.width } : {}) },
      mime: { default: "", parseHTML: (el) => el.getAttribute("data-mime") || "", renderHTML: (a) => (a.mime ? { "data-mime": a.mime } : {}) },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-file-id]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // Der Name steht auch als Text im HTML: so bleibt er in der Volltextsuche auffindbar
    return ["div", mergeAttributes(HTMLAttributes), node.attrs.name];
  },

  renderText({ node }) {
    return node.attrs.name as string;
  },

  addCommands() {
    return {
      insertFileAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileCard);
  },
});
