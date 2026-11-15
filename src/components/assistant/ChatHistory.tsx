import { useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import type { ChatInfo } from "../../lib/api/chats";
import { shortWhen } from "../../lib/chatGroups";
import "./Chats.css";

interface ChatHistoryProps {
  chats: ChatInfo[];
  activeChatId: number | null;
  disabled: boolean;
  onSelect: (id: number) => void;
}

const SHOWN = 14;

/** Verlauf für die schmale Seitenleiste: ein Knopf, der die letzten Chats zur Auswahl zeigt (die große Ansicht hat eine eigene Leiste). */
export function ChatHistory({ chats, activeChatId, disabled, onSelect }: ChatHistoryProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="ch-wrap" ref={ref}>
      <button type="button" className={`icon-btn${open ? " active" : ""}`} aria-label="Frühere Chats" aria-expanded={open} title="Frühere Chats" disabled={disabled || chats.length === 0} onClick={() => setOpen((o) => !o)}>
        <History size={15} />
      </button>
      {open && (
        <div className="ch-pop" role="menu">
          <p className="ch-title">Frühere Chats</p>
          <ul>
            {chats.slice(0, SHOWN).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="menuitem"
                  className={`ch-item${c.id === activeChatId ? " active" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    onSelect(c.id);
                  }}
                >
                  <span className="cs-title">{c.title || "Neuer Chat"}</span>
                  <span className="cs-when">{shortWhen(c.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {chats.length > SHOWN && <p className="ch-more">Alle Chats findest du in der großen Ansicht.</p>}
        </div>
      )}
    </div>
  );
}
