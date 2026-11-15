import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FolderInput, FolderKanban, FolderOutput, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, SquarePen, Trash2, X } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { searchChats, type ChatHit, type ChatInfo } from "../../lib/api/chats";
import { groupByAge, shortWhen } from "../../lib/chatGroups";
import type { Project } from "../../lib/projects";
import "./Chats.css";

interface ChatSidebarProps {
  chats: ChatInfo[];
  projects: Project[];
  /** Der Chat, der gerade offen ist (null: ein neuer, noch nicht gespeicherter) */
  activeChatId: number | null;
  /** Das Projekt, dessen Seite gerade offen ist */
  activeProjectId: number | null;
  /** Solange der Assistent antwortet, bleibt der Chat, wie er ist */
  disabled: boolean;
  onNewChat: (projectId: number | null) => void;
  onSelectChat: (id: number) => void;
  onSelectProject: (id: number) => void;
  onCreateProject: () => void;
  onEditProject: (project: Project) => void;
  onRename: (chat: ChatInfo, title: string) => void;
  onPin: (chat: ChatInfo, pinned: boolean) => void;
  onMove: (chat: ChatInfo, projectId: number | null) => void;
  onDelete: (chat: ChatInfo) => void;
}

const EXPANDED_KEY = "assistantExpandedProjects";

function loadExpanded(): Set<number> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === "number") : []);
  } catch {
    return new Set();
  }
}

/**
 * Leiste links in der großen Ansicht: neuer Chat, Suche, angeheftete Chats, Projekte mit ihren Chats und alle übrigen Chats
 * nach Datum. Die Chats liegen nur auf diesem Rechner.
 */
export function ChatSidebar({ chats, projects, activeChatId, activeProjectId, disabled, onNewChat, onSelectChat, onSelectProject, onCreateProject, onEditProject, onRename, onPin, onMove, onDelete }: ChatSidebarProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ChatHit[] | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(loadExpanded);
  const [menu, setMenu] = useState<{ chat: ChatInfo; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);

  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  // Ein Chat, dessen Projekt gelöscht wurde, gilt als Chat ohne Projekt
  const projectOf = (c: ChatInfo) => (c.projectId !== null && projectIds.has(c.projectId) ? c.projectId : null);
  const pinned = chats.filter((c) => c.pinned);
  const loose = chats.filter((c) => !c.pinned && projectOf(c) === null);
  const groups = useMemo(() => groupByAge(loose), [loose]);
  const byProject = (id: number) => chats.filter((c) => !c.pinned && projectOf(c) === id);

  // Suche: kurz warten, bis die Eingabe ruht
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      searchChats(q)
        .then((found) => current && setHits(found))
        .catch(() => current && setHits([]));
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  // Wird ein Chat in einem Projekt geöffnet, klappt sein Projekt auf: man soll sehen, wo er liegt
  const activeProject = (() => {
    const chat = chats.find((c) => c.id === activeChatId);
    return chat ? projectOf(chat) : null;
  })();
  useEffect(() => {
    if (activeProject === null) return;
    setExpanded((prev) => (prev.has(activeProject) ? prev : new Set(prev).add(activeProject)));
  }, [activeChatId, activeProject]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      try {
        localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
      } catch {
        /* Merken ist nur Komfort */
      }
      return next;
    });

  const menuItems = (chat: ChatInfo): ContextMenuItem[] => {
    const current = projectOf(chat);
    const items: ContextMenuItem[] = [
      { label: "Umbenennen", icon: Pencil, onClick: () => setRenaming(chat.id) },
      { label: chat.pinned ? "Nicht mehr anheften" : "Anheften", icon: chat.pinned ? PinOff : Pin, onClick: () => onPin(chat, !chat.pinned) },
    ];
    projects
      .filter((p) => p.id !== current)
      .forEach((p, i) => items.push({ label: `In „${p.name}“ verschieben`, icon: FolderInput, divider: i === 0, onClick: () => onMove(chat, p.id) }));
    if (current !== null) items.push({ label: "Aus dem Projekt lösen", icon: FolderOutput, divider: projects.length <= 1, onClick: () => onMove(chat, null) });
    items.push({ label: "Chat löschen", icon: Trash2, danger: true, divider: true, onClick: () => onDelete(chat) });
    return items;
  };

  const row = (chat: ChatInfo, nested = false) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      nested={nested}
      active={activeProjectId === null && activeChatId === chat.id}
      disabled={disabled && activeChatId !== chat.id}
      renaming={renaming === chat.id}
      onSelect={() => onSelectChat(chat.id)}
      onMenu={(x, y) => setMenu({ chat, x, y })}
      onRename={(title) => {
        setRenaming(null);
        if (title.trim() && title.trim() !== chat.title) onRename(chat, title.trim());
      }}
      onCancelRename={() => setRenaming(null)}
    />
  );

  return (
    <nav className="cs-bar" aria-label="Chats und Projekte">
      <button type="button" className="cs-new" disabled={disabled} onClick={() => onNewChat(null)}>
        <SquarePen size={15} />
        Neuer Chat
      </button>

      <label className="cs-search">
        <Search size={14} />
        <input value={query} placeholder="Chats durchsuchen" aria-label="Chats durchsuchen" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <button type="button" className="cs-clear" aria-label="Suche leeren" onClick={() => setQuery("")}>
            <X size={13} />
          </button>
        )}
      </label>

      <div className="cs-scroll">
        {hits !== null ? (
          <section className="cs-section">
            <h3 className="cs-label">{hits.length === 0 ? "Nichts gefunden" : `${hits.length} ${hits.length === 1 ? "Treffer" : "Treffer"}`}</h3>
            <ul className="cs-list">
              {hits.map((hit) => (
                <li key={hit.chatId}>
                  <button type="button" className={`cs-hit${activeChatId === hit.chatId ? " active" : ""}`} disabled={disabled && activeChatId !== hit.chatId} onClick={() => onSelectChat(hit.chatId)}>
                    <span className="cs-title">{hit.title || "Neuer Chat"}</span>
                    {hit.snippet && <span className="cs-snippet">{hit.snippet}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
            {pinned.length > 0 && (
              <section className="cs-section">
                <h3 className="cs-label">Angeheftet</h3>
                <ul className="cs-list">{pinned.map((c) => row(c))}</ul>
              </section>
            )}

            <section className="cs-section">
              <h3 className="cs-label cs-label-row">
                <span>Projekte</span>
                <button type="button" className="icon-btn" aria-label="Neues Projekt" title="Neues Projekt" onClick={onCreateProject}>
                  <Plus size={14} />
                </button>
              </h3>
              {projects.length === 0 ? (
                <p className="cs-hint">Ein Projekt gibt Chats einen festen Kontext aus deiner Dokumentation und eigene Hinweise.</p>
              ) : (
                <ul className="cs-list">
                  {projects.map((p) => {
                    const own = byProject(p.id);
                    const open = expanded.has(p.id);
                    return (
                      <li key={p.id}>
                        <div className={`cs-project${activeProjectId === p.id ? " active" : ""}`}>
                          <button type="button" className="cs-chevron" aria-label={open ? "Zuklappen" : "Aufklappen"} aria-expanded={open} onClick={() => toggle(p.id)}>
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <button type="button" className="cs-project-main" disabled={disabled} onClick={() => onSelectProject(p.id)}>
                            <FolderKanban size={14} />
                            <span className="cs-title">{p.name}</span>
                          </button>
                          <span className="cs-project-actions">
                            <button type="button" className="icon-btn" aria-label={`Neuer Chat in „${p.name}“`} title="Neuer Chat im Projekt" disabled={disabled} onClick={() => onNewChat(p.id)}>
                              <Plus size={13} />
                            </button>
                            <button type="button" className="icon-btn" aria-label={`Projekt „${p.name}“ bearbeiten`} title="Projekt bearbeiten" onClick={() => onEditProject(p)}>
                              <Pencil size={12} />
                            </button>
                          </span>
                        </div>
                        {open && (
                          <ul className="cs-list cs-nested">
                            {own.length === 0 ? <li className="cs-none">Noch keine Chats</li> : own.map((c) => row(c, true))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {groups.map((g) => (
              <section key={g.key} className="cs-section">
                <h3 className="cs-label">{g.label}</h3>
                <ul className="cs-list">{g.chats.map((c) => row(c))}</ul>
              </section>
            ))}

            {chats.length === 0 && projects.length === 0 && <p className="cs-hint cs-first">Deine Chats erscheinen hier. Sie bleiben auf diesem Rechner gespeichert.</p>}
          </>
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.chat)} onClose={() => setMenu(null)} />}
    </nav>
  );
}

interface ChatRowProps {
  chat: ChatInfo;
  nested: boolean;
  active: boolean;
  disabled: boolean;
  renaming: boolean;
  onSelect: () => void;
  onMenu: (x: number, y: number) => void;
  onRename: (title: string) => void;
  onCancelRename: () => void;
}

function ChatRow({ chat, nested, active, disabled, renaming, onSelect, onMenu, onRename, onCancelRename }: ChatRowProps) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(chat.title);

  useEffect(() => {
    if (renaming) {
      setValue(chat.title);
      window.setTimeout(() => input.current?.select(), 0);
    }
  }, [renaming, chat.title]);

  if (renaming) {
    return (
      <li className="cs-row editing">
        <input
          ref={input}
          className="cs-rename"
          value={value}
          maxLength={120}
          aria-label="Titel des Chats"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => onRename(value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onRename(value);
            if (e.key === "Escape") onCancelRename();
          }}
        />
      </li>
    );
  }

  return (
    <li
      className={`cs-row${active ? " active" : ""}${nested ? " nested" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      <button type="button" className="cs-item" disabled={disabled} onClick={onSelect} title={chat.title || "Neuer Chat"}>
        {chat.pinned && <Pin size={11} className="cs-pin" />}
        <span className="cs-title">{chat.title || "Neuer Chat"}</span>
        <span className="cs-when">{shortWhen(chat.updatedAt)}</span>
      </button>
      <button
        type="button"
        className="cs-more"
        aria-label="Mehr"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(r.right - 190, r.bottom + 4);
        }}
      >
        <MoreHorizontal size={15} />
      </button>
    </li>
  );
}
