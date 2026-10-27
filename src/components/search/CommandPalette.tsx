import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  CornerDownLeft,
  FilePlus2,
  FolderPlus,
  LayoutDashboard,
  Network,
  NotebookText,
  PanelLeft,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { listEvents } from "../../lib/api/events";
import { loadTradingState } from "../../lib/api/trading";
import { formatDayMonth, parseDateTime, startOfDay, addDays, toDateTimeStr } from "../../lib/dates";
import { useDialogs } from "../../lib/dialogs";
import { isEmptyPage, isFolder, pageTitle } from "../../lib/docs";
import { requestOpenDoc } from "../../lib/docsNav";
import { useNavigate, type ViewId } from "../../lib/navigation";
import { formatNoteTime, isEmptyNote, noteTitle } from "../../lib/notes";
import { createAndOpenNote } from "../../lib/notesActions";
import { requestOpenNote } from "../../lib/notesNav";
import { requestOpen } from "../../lib/openTarget";
import { highlight, score, snippet, tokens } from "../../lib/search";
import type { CalendarEvent } from "../../lib/calendar";
import type { Trade } from "../../lib/trading";
import { formatDue } from "../../lib/tasks";
import { useDocs } from "../../lib/useDocs";
import { useNotes } from "../../lib/useNotes";
import { useStrategies } from "../../lib/useStrategies";
import { useSync } from "../../lib/useSync";
import { useTasks } from "../../lib/useTasks";
import "./CommandPalette.css";

interface Entry {
  key: string;
  group: string;
  icon: LucideIcon;
  title: string;
  sub?: string;
  /** Rechts angezeigt: Tastenkürzel oder Art */
  hint?: string;
  rank: number;
  run: () => void;
}

/** Reihenfolge der Gruppen im Ergebnis */
const GROUPS = ["Befehle", "Seiten", "Notizen", "Aufgaben", "Termine", "Trading", "Strategien"];
const PER_GROUP = 5;
const PER_GROUP_IDLE = 4;

/** Größer als jeder Zeitstempel: damit früher = höher einsortiert werden kann */
const BIG = 1e9;

const STATUS_LABEL: Record<Trade["status"], string> = { open: "Offene Position", closed: "Geschlossen", order: "Order" };

interface CommandPaletteProps {
  onClose: () => void;
  onToggleSidebar: () => void;
}

/**
 * Schnellzugriff (Strg K): sucht in Seiten, Notizen, Aufgaben, Terminen, Positionen und Strategien und führt Befehle
 * aus. Pfeiltasten wählen, Enter öffnet, Esc schließt. Das Fenster ist nur offen, solange es gebraucht wird; die Daten
 * lädt es beim Öffnen frisch.
 */
export function CommandPalette({ onClose, onToggleSidebar }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { openNewTask, openNewBucket, openEditTask, openSettings } = useDialogs();
  const { tasks, buckets } = useTasks();
  const { notes } = useNotes();
  const { pages } = useDocs();
  const { strategies } = useStrategies();
  const sync = useSync();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Termine (ein Jahr zurück und voraus) und Positionen einmalig laden
  useEffect(() => {
    let cancelled = false;
    const today = startOfDay(new Date());
    listEvents(toDateTimeStr(addDays(today, -365)), toDateTimeStr(addDays(today, 365)))
      .then((list) => !cancelled && setEvents(list))
      .catch(() => undefined);
    loadTradingState()
      .then((s) => !cancelled && setTrades(s.trades))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const terms = useMemo(() => tokens(query), [query]);
  const idle = terms.length === 0;

  const entries = useMemo(() => {
    const go = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const all: Entry[] = [];
    const push = (e: Omit<Entry, "rank">, rank: number) => rank > 0 && all.push({ ...e, rank });

    // Befehle
    const views: { id: ViewId; label: string; icon: LucideIcon; words: string }[] = [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, words: "start übersicht" },
      { id: "tasks", label: "Aufgaben", icon: CheckSquare, words: "todo buckets board zeitplan heute" },
      { id: "calendar", label: "Kalender", icon: CalendarDays, words: "termine" },
      { id: "notes", label: "Notizen", icon: NotebookText, words: "notiz" },
      { id: "docs", label: "Dokumentation", icon: BookOpen, words: "wiki seiten" },
      { id: "assistant", label: "Assistent", icon: Sparkles, words: "ki chat projekte fragen" },
      { id: "trading", label: "Trading", icon: TrendingUp, words: "vermögen positionen assets depot" },
      { id: "strategies", label: "Strategien", icon: Network, words: "graph" },
    ];
    const commands: { title: string; words: string; icon: LucideIcon; hint?: string; run: () => void }[] = [
      { title: "Neue Aufgabe", words: "erstellen anlegen todo", icon: CheckSquare, run: () => openNewTask() },
      { title: "Neue Notiz", words: "erstellen anlegen schnellnotiz", icon: NotebookText, run: () => void createAndOpenNote(navigate) },
      {
        title: "Neue Seite",
        words: "erstellen anlegen dokumentation ordner",
        icon: FilePlus2,
        run: () => {
          navigate("docs");
          requestOpen({ kind: "new-doc" });
        },
      },
      { title: "Neuer Bucket", words: "erstellen anlegen spalte", icon: FolderPlus, run: () => openNewBucket() },
      { title: "Einstellungen öffnen", words: "optionen profil", icon: Settings, run: () => openSettings() },
      { title: "Abgleich einrichten", words: "sync onedrive rechner einstellungen", icon: RefreshCw, run: () => openSettings("sync") },
      { title: "Seitenleiste ein- oder ausblenden", words: "sidebar menü", icon: PanelLeft, hint: "Strg B", run: onToggleSidebar },
    ];
    if (sync.status?.enabled) {
      commands.push({ title: "Jetzt abgleichen", words: "sync onedrive speichern", icon: RefreshCw, run: () => void sync.now() });
    }
    for (const c of commands) {
      push({ key: `cmd-${c.title}`, group: "Befehle", icon: c.icon, title: c.title, hint: c.hint, run: go(c.run) }, score(c.title, c.words, terms) * (idle ? 1 : 1.2));
    }
    for (const v of views) {
      push({ key: `view-${v.id}`, group: "Befehle", icon: v.icon, title: `Gehe zu ${v.label}`, run: go(() => navigate(v.id)) }, score(`Gehe zu ${v.label}`, `${v.label} ${v.words}`, terms));
    }

    // Dokumentationsseiten (Ordner zählen mit, sie lassen sich öffnen)
    for (const p of pages) {
      const folder = isFolder(p);
      const parent = pages.find((x) => x.id === p.parentId);
      if (!folder && !p.title.trim() && isEmptyPage(p)) continue;
      push(
        {
          key: `doc-${p.id}`,
          group: "Seiten",
          icon: BookOpen,
          title: pageTitle(p),
          sub: idle ? (parent ? pageTitle(parent) : folder ? "Ordner" : "") : [parent ? pageTitle(parent) : null, snippet(p.plain, terms, 70)].filter(Boolean).join(" · "),
          hint: folder ? "Ordner" : undefined,
          run: go(() => {
            requestOpenDoc(p.id);
            navigate("docs");
          }),
        },
        idle ? tickOf(p.updatedAt) : score(pageTitle(p), p.plain, terms),
      );
    }

    // Notizen
    for (const n of notes) {
      if (isEmptyNote(n)) continue;
      push(
        {
          key: `note-${n.id}`,
          group: "Notizen",
          icon: NotebookText,
          title: noteTitle(n),
          sub: idle ? formatNoteTime(n.updatedAt) : [n.folder || null, snippet(n.plain, terms, 70)].filter(Boolean).join(" · "),
          run: go(() => {
            requestOpenNote(n.id);
            navigate("notes");
          }),
        },
        idle ? tickOf(n.updatedAt) : score(noteTitle(n), `${n.plain} ${n.folder}`, terms),
      );
    }

    // Aufgaben (erledigte nur bei konkreter Suche)
    for (const t of tasks) {
      if (idle && t.done) continue;
      const bucket = buckets.find((b) => b.id === t.bucketId)?.name;
      push(
        {
          key: `task-${t.id}`,
          group: "Aufgaben",
          icon: CheckSquare,
          title: t.title,
          sub: [bucket, t.dueDate ? formatDue(t.dueDate) : null, t.done ? "Erledigt" : null].filter(Boolean).join(" · "),
          run: go(() => openEditTask(t)),
        },
        idle ? (t.dueDate ? BIG - tickOf(`${t.dueDate} 00:00`) : 1) : score(t.title, `${t.description} ${bucket ?? ""} ${t.subtasks.map((s) => s.title).join(" ")}`, terms),
      );
    }

    // Termine: ohne Suche nur die nächsten
    const nowStr = toDateTimeStr(new Date());
    for (const e of events) {
      if (idle && e.endsAt <= nowStr) continue;
      push(
        {
          key: `event-${e.id}`,
          group: "Termine",
          icon: CalendarDays,
          title: e.title,
          sub: `${formatDayMonth(parseDateTime(e.startsAt))}${e.allDay ? "" : ` · ${e.startsAt.slice(11)}`}${e.location ? ` · ${e.location}` : ""}`,
          run: go(() => {
            navigate("calendar");
            requestOpen({ kind: "event", id: e.id, date: e.startsAt.slice(0, 10) });
          }),
        },
        idle ? BIG - tickOf(e.startsAt) : score(e.title, `${e.description} ${e.location}`, terms),
      );
    }

    // Positionen (ohne Suche nicht gezeigt, das wäre Lärm)
    if (!idle) {
      for (const t of trades) {
        push(
          {
            key: `trade-${t.id}`,
            group: "Trading",
            icon: TrendingUp,
            title: `${t.symbol} · ${t.name}`,
            sub: STATUS_LABEL[t.status],
            run: go(() => {
              navigate("trading");
              requestOpen({ kind: "trade", id: t.id });
            }),
          },
          score(`${t.symbol} ${t.name}`, `${t.thesis} ${t.assetClass}`, terms),
        );
      }
    }

    // Strategien (auch ihre Knoten)
    for (const s of strategies) {
      const nodeHit = idle ? undefined : s.nodes.find((n) => score(n.title, "", terms) > 0);
      push(
        {
          key: `strategy-${s.id}`,
          group: "Strategien",
          icon: Network,
          title: s.title,
          sub: nodeHit ? `Enthält „${nodeHit.title}“` : `${s.nodes.length} Knoten`,
          run: go(() => {
            navigate("strategies");
            requestOpen({ kind: "strategy", id: s.id });
          }),
        },
        idle ? tickOf(s.updatedAt) : Math.max(score(s.title, "", terms), nodeHit ? 15 : 0),
      );
    }

    // Gruppieren, innerhalb nach Güte sortieren, begrenzen
    const limit = idle ? PER_GROUP_IDLE : PER_GROUP;
    const out: Entry[] = [];
    for (const group of GROUPS) {
      if (idle && !["Befehle", "Seiten", "Notizen", "Aufgaben", "Termine"].includes(group)) continue;
      const rows = all.filter((e) => e.group === group).sort((a, b) => b.rank - a.rank || (group === "Befehle" ? 0 : a.title.localeCompare(b.title, "de")));
      // Ohne Suche: Befehle knapp halten
      out.push(...rows.slice(0, group === "Befehle" && idle ? 5 : limit));
    }
    return out;
  }, [terms, idle, pages, notes, tasks, buckets, events, trades, strategies, sync.status?.enabled, onClose, navigate, openNewTask, openNewBucket, openEditTask, openSettings, onToggleSidebar, sync]);

  // Auswahl bleibt innerhalb der Liste, springt bei neuer Eingabe nach oben
  useEffect(() => setActive(0), [query]);
  const current = Math.min(active, Math.max(entries.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, entries.length]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(entries.length ? (current + 1) % entries.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(entries.length ? (current - 1 + entries.length) % entries.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      entries[current]?.run();
    }
  };

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [onClose]);

  const render = (text: string): ReactNode =>
    highlight(text, terms).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>));

  let lastGroup = "";
  return createPortal(
    <div className="cp-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cp-box" role="dialog" aria-modal="true" aria-label="Suchen oder Befehl eingeben" onKeyDown={onKey}>
        <div className="cp-input">
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Suchen oder Befehl eingeben …"
            aria-label="Suche"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="cp-list" ref={listRef} role="listbox">
          {entries.length === 0 ? (
            <p className="cp-empty">Nichts gefunden für „{query.trim()}“.</p>
          ) : (
            entries.map((entry, i) => {
              const header = entry.group !== lastGroup ? (lastGroup = entry.group) : null;
              const Icon = entry.icon;
              return (
                <div key={entry.key}>
                  {header && <div className="cp-group">{idle && header === "Seiten" ? "Zuletzt: Seiten" : idle && header === "Notizen" ? "Zuletzt: Notizen" : idle && header === "Termine" ? "Nächste Termine" : header}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === current}
                    data-index={i}
                    className={`cp-item${i === current ? " active" : ""}`}
                    onMouseMove={() => i !== current && setActive(i)}
                    onClick={entry.run}
                  >
                    <span className="cp-icon">
                      <Icon size={15} />
                    </span>
                    <span className="cp-text">
                      <span className="cp-title">{render(entry.title)}</span>
                      {entry.sub && <span className="cp-sub">{render(entry.sub)}</span>}
                    </span>
                    {entry.hint && <span className="cp-hint">{entry.hint}</span>}
                    {i === current && <CornerDownLeft size={13} className="cp-enter" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <footer className="cp-foot">
          <span>
            <span className="kbd">↑</span> <span className="kbd">↓</span> wählen
          </span>
          <span>
            <span className="kbd">Enter</span> öffnen
          </span>
          <span className="cp-foot-end">Tippe für Suche, „neue“ für Befehle</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Zeitstempel (UTC-Text) als Zahl, damit Neueres höher einsortiert wird. */
function tickOf(stamp: string): number {
  return Date.parse(`${stamp.replace(" ", "T")}Z`) / 60000 || 0;
}
