import { useRef, useState } from "react";
import { BookOpen, ChevronRight, FolderKanban, Paperclip, Pencil, X } from "lucide-react";
import { openAttachment } from "../../lib/api/attachments";
import type { ChatInfo } from "../../lib/api/chats";
import { shortWhen } from "../../lib/chatGroups";
import { MAX_PROJECT_FILES, type Project } from "../../lib/projects";
import { formatBytes, kindOf } from "../files/FileAttachment";
import { SecondaryButton } from "../ui/SecondaryButton";
import "./Chats.css";

interface ProjectOverviewProps {
  project: Project;
  /** Pfad der zugeordneten Dokumentation zur Anzeige (leer, wenn es keine gibt) */
  contextPath: string;
  /** Die Chats dieses Projekts, die zuletzt benutzten zuerst */
  chats: ChatInfo[];
  onOpenChat: (id: number) => void;
  onEdit: () => void;
  /** Öffnet die zugeordnete Dokumentation (nur, wenn es sie gibt) */
  onOpenDocs: () => void;
  /** Dateien als festen Kontext hinzufügen */
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (fileId: number) => void;
  /** Wie viele Dateien gerade gespeichert werden */
  uploading: number;
  error: string | null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Startansicht eines Projekts, wie die Ordneransicht der Dokumentation aufgebaut: Kopf mit Namen, links die Chats des
 * Projekts, rechts sein Kontext (Dokumentation, Hinweise, feste Dateien). Ein neuer Chat entsteht mit der ersten Frage unten.
 */
export function ProjectOverview({ project, contextPath, chats, onOpenChat, onEdit, onOpenDocs, onAddFiles, onRemoveFile, uploading, error }: ProjectOverviewProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const full = project.files.length >= MAX_PROJECT_FILES;
  const instructions = project.instructions.trim();

  return (
    <div className="po">
      <header className="po-head">
        <span className="po-icon" aria-hidden>
          <FolderKanban size={22} />
        </span>
        <div className="po-title">
          <h2>{project.name}</h2>
          <p className="po-meta">
            <span>{count(chats.length, "Chat", "Chats")}</span>
            <span className="po-dot">·</span>
            <span>{count(project.files.length, "Datei", "Dateien")}</span>
          </p>
        </div>
        <SecondaryButton className="sm" onClick={onEdit}>
          <Pencil size={13} />
          Bearbeiten
        </SecondaryButton>
      </header>

      <div className="po-grid">
        <section className="po-card" aria-label="Chats">
          <div className="po-card-head">
            <h3>Chats</h3>
          </div>
          {chats.length === 0 ? (
            <p className="po-empty">Noch keine Chats</p>
          ) : (
            <ul className="po-list">
              {chats.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <button type="button" className="po-chat" onClick={() => onOpenChat(c.id)}>
                    <span className="po-chat-main">
                      <span className="po-chat-title">{c.title || "Neuer Chat"}</span>
                      {c.preview && <span className="po-chat-preview">{c.preview}</span>}
                    </span>
                    <span className="po-chat-when">{shortWhen(c.updatedAt)}</span>
                    <ChevronRight size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {chats.length > 8 && <p className="po-more">{chats.length - 8} weitere in der Seitenleiste</p>}
        </section>

        <section className="po-card" aria-label="Kontext">
          <div className="po-card-head">
            <h3>Kontext</h3>
          </div>

          <div className="po-prop">
            <span className="po-label">Dokumentation</span>
            {contextPath ? (
              <button type="button" className="po-link" onClick={onOpenDocs} title="In der Dokumentation öffnen">
                <BookOpen size={14} />
                <span>{contextPath}</span>
                <ChevronRight size={13} />
              </button>
            ) : (
              <span className="po-muted">{project.docId === null ? "Keine" : "Die Seite gibt es nicht mehr"}</span>
            )}
          </div>

          <div className="po-prop">
            <span className="po-label">Hinweise</span>
            {instructions ? <p className="po-text">{instructions}</p> : <span className="po-muted">Keine</span>}
          </div>

          <div className="po-prop">
            <span className="po-label">Dateien</span>
            {project.files.length > 0 && (
              <ul className="po-files">
                {project.files.map((f) => {
                  const { icon: Icon, tone } = kindOf(f.name, f.mime);
                  return (
                    <li key={f.fileId} className="po-file">
                      <button type="button" className="po-file-open" title={`${f.name} öffnen`} onClick={() => void openAttachment(f.fileId).catch(() => undefined)}>
                        <Icon size={15} className={`file-card-icon ${tone}`} />
                        <span className="po-file-name">{f.name}</span>
                        <span className="po-file-size">{formatBytes(f.size)}</span>
                      </button>
                      <button type="button" className="icon-btn po-file-remove" aria-label={`„${f.name}“ aus dem Projekt nehmen`} title="Aus dem Projekt nehmen" onClick={() => onRemoveFile(f.fileId)}>
                        <X size={13} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <button
              type="button"
              className={`po-drop${dropping ? " active" : ""}`}
              disabled={full}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                if (full || !e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => {
                setDropping(false);
                if (full || e.dataTransfer.files.length === 0) return;
                e.preventDefault();
                onAddFiles([...e.dataTransfer.files]);
              }}
            >
              <Paperclip size={14} />
              <span>{uploading > 0 ? "Wird gespeichert …" : full ? `Höchstens ${MAX_PROJECT_FILES} Dateien` : "Datei hinzufügen"}</span>
            </button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                onAddFiles([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
