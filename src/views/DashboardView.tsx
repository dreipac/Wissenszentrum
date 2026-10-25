import { BookOpen, CalendarClock, CircleAlert, ClipboardList, FileText, Flame, Plus } from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { formatTimeRange, openPrep } from "../lib/calendar";
import { TaskBadge } from "../components/calendar/EventLinkedTasks";
import { EventLink } from "../components/tasks/parts";
import { addDays, formatDayMonth, formatLongDay, parseDateTime, startOfDay, toDateTimeStr } from "../lib/dates";
import { useDialogs } from "../lib/dialogs";
import { useNavigate } from "../lib/navigation";
import { useProfile } from "../lib/profile";
import { formatNoteTime, isEmptyNote, noteTitle, notePreview } from "../lib/notes";
import { createAndOpenNote } from "../lib/notesActions";
import { requestOpenNote } from "../lib/notesNav";
import { requestOpenDoc } from "../lib/docsNav";
import { isEmptyPage, isFolder, pageTitle, type DocPage } from "../lib/docs";
import { useDocs } from "../lib/useDocs";
import { daysUntil, formatDue, isOverdue } from "../lib/tasks";
import { useEvents } from "../lib/useEvents";
import { useNotes } from "../lib/useNotes";
import { useTasks } from "../lib/useTasks";
import "./DashboardView.css";

/** Tageszeit-Gruß: bis 11 Uhr Morgen, bis 17 Uhr Tag, danach Abend. */
const greeting = (now: Date) => {
  const h = now.getHours();
  return h < 11 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
};

/** Titel der übergeordneten Seite oder des Ordners, leer auf der Hauptebene. */
function parentTitle(pages: DocPage[], page: DocPage): string {
  const parent = pages.find((x) => x.id === page.parentId);
  return parent ? pageTitle(parent) : "";
}

interface RecentItem {
  key: string;
  kind: "note" | "doc";
  title: string;
  preview: string;
  tag: string;
  updatedAt: string;
  open: () => void;
}

export function DashboardView() {
  const profile = useProfile();
  const { tasks } = useTasks();
  const { notes } = useNotes();
  const { pages } = useDocs();
  const { openNewTask } = useDialogs();
  const navigate = useNavigate();
  // Zuletzt bearbeitet: Notizen und Dokumentationsseiten gemischt, nach Zeitpunkt (unabhängig vom Anpinnen)
  const recent: RecentItem[] = [
    ...notes
      .filter((n) => !isEmptyNote(n))
      .map<RecentItem>((n) => ({
        key: `note-${n.id}`,
        kind: "note",
        title: noteTitle(n),
        preview: notePreview(n, 100) || "Kein weiterer Text",
        tag: n.folder,
        updatedAt: n.updatedAt,
        open: () => {
          requestOpenNote(n.id);
          navigate("notes");
        },
      })),
    ...pages
      .filter((p) => !isFolder(p) && (p.title.trim() || !isEmptyPage(p)))
      .map<RecentItem>((p) => ({
        key: `doc-${p.id}`,
        kind: "doc",
        title: pageTitle(p),
        preview: p.plain.split(/\s+/).join(" ").trim().slice(0, 100) || "Kein weiterer Text",
        // Wo die Seite liegt: die übergeordnete Seite bzw. der Ordner
        tag: parentTitle(pages, p),
        updatedAt: p.updatedAt,
        open: () => {
          requestOpenDoc(p.id);
          navigate("docs");
        },
      })),
  ]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.key.localeCompare(a.key))
    .slice(0, 5);
  // Anstehende Termine der nächsten 7 Tage aus der Datenbank
  const today = startOfDay(new Date());
  const { events } = useEvents(toDateTimeStr(today), toDateTimeStr(addDays(today, 7)));
  const nowStr = toDateTimeStr(new Date());
  const upcoming = events.filter((e) => e.endsAt > nowStr);
  const next = upcoming[0];
  // Ruhiger Hinweis: Termin heute bis übermorgen, für den noch Vorbereitung offen ist
  const dayWord = ["Heute", "Morgen", "Übermorgen"];
  const unprepared = upcoming
    .filter((e) => openPrep(e) > 0 && daysUntil(e.startsAt.slice(0, 10)) <= 2)
    .map((e) => ({ event: e, open: openPrep(e), when: dayWord[Math.max(daysUntil(e.startsAt.slice(0, 10)), 0)] }));

  // Aufgaben: offene, heute fällige und überfällige
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => isOverdue(t));
  const dueToday = open.filter((t) => t.dueDate !== null && daysUntil(t.dueDate) === 0);
  // Wichtig und fällig: Überfälliges und heute Fälliges zuerst, danach alles Übrige mit hoher Priorität (nach Datum)
  const urgentIds = new Set([...overdue, ...dueToday].map((t) => t.id));
  const important = open
    .filter((t) => t.priority === "high" && !urgentIds.has(t.id))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id - b.id);
  const focus = [...overdue, ...dueToday, ...important];
  const highToday = dueToday.filter((t) => t.priority === "high").length;

  const stats = [
    {
      label: "Offene Aufgaben",
      value: String(open.length),
      hint: overdue.length ? `${overdue.length} überfällig` : open.length ? "Nichts überfällig" : "Alles erledigt",
      icon: ClipboardList,
    },
    {
      label: "Heute fällig",
      value: String(dueToday.length),
      hint: highToday ? `${highToday} mit hoher Priorität` : "Keine mit hoher Priorität",
      icon: Flame,
    },
    {
      label: "Termine (7 Tage)",
      value: String(upcoming.length),
      hint: next ? `Nächster: ${formatDayMonth(parseDateTime(next.startsAt))}${next.allDay ? "" : ` ${next.startsAt.slice(11)}`}` : "Keine anstehenden Termine",
      icon: CalendarClock,
    },
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">{greeting(new Date())}, {profile.firstName}</h1>
            <p className="page-subtitle">
              {formatLongDay(new Date())} · {dueToday.length} {dueToday.length === 1 ? "Aufgabe" : "Aufgaben"} heute fällig
            </p>
          </div>
          <div className="page-actions">
            <SecondaryButton onClick={() => void createAndOpenNote(navigate)}>
              <Plus size={16} />
              Schnellnotiz
            </SecondaryButton>
            <Button onClick={() => openNewTask()}>
              <Plus size={16} />
              Neue Aufgabe
            </Button>
          </div>
        </div>
      </header>

      <div className="page-body">
        <div className="stat-grid">
          {stats.map(({ label, value, hint, icon: Icon }) => (
            <div key={label} className="card stat-card">
              <div className="stat-top">
                <span className="card-title">{label}</span>
                <span className="stat-icon">
                  <Icon size={16} />
                </span>
              </div>
              <div className="stat-value">{value}</div>
              <div className="stat-hint">{hint}</div>
            </div>
          ))}
        </div>

        <div className="dash-grid">
          <section className="card dash-card">
            <div className="dash-card-head">
              <h2>Wichtig &amp; fällig</h2>
              <SecondaryButton className="sm" onClick={() => navigate("tasks")}>
                Alle Aufgaben
              </SecondaryButton>
            </div>
            {focus.length === 0 ? (
              <p className="muted">Nichts Dringendes – heute ist nichts fällig und nichts mit hoher Priorität offen.</p>
            ) : (
              <ul className="focus-list">
                {focus.map((t) => (
                  <li key={t.id} className="focus-item">
                    <span className={`priority ${t.priority}`} />
                    <div className="focus-main">
                      <span className="focus-title">{t.title}</span>
                      <EventLink task={t} />
                    </div>
                    {t.dueDate && <span className={`due${isOverdue(t) ? " urgent" : ""}`}>{formatDue(t.dueDate)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card dash-card">
            <div className="dash-card-head">
              <h2>Nächste Termine</h2>
            </div>
            {unprepared.length > 0 && (
              <ul className="agenda-notices">
                {unprepared.map(({ event, open, when }) => (
                  <li key={event.id} className="agenda-notice">
                    <CircleAlert size={14} />
                    <span>
                      {when}: {event.title} – {open} {open === 1 ? "Aufgabe" : "Aufgaben"} zur Vorbereitung offen
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {upcoming.length === 0 ? (
              <p className="muted">Keine Termine in den nächsten 7 Tagen.</p>
            ) : (
              <ul className="agenda-list">
                {upcoming.slice(0, 5).map((e) => (
                  <li key={e.id} className="agenda-item">
                    <span className="agenda-bar" />
                    <div className="agenda-main">
                      <span className="agenda-title">{e.title}</span>
                      <span className="agenda-time">
                        {formatDayMonth(parseDateTime(e.startsAt))} · {formatTimeRange(e)}
                      </span>
                    </div>
                    <div className="agenda-side">
                      <TaskBadge event={e} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card dash-card full">
            <div className="dash-card-head">
              <h2>Zuletzt bearbeitet</h2>
              <div className="dash-card-links">
                <SecondaryButton className="sm" onClick={() => navigate("notes")}>
                  Notizen
                </SecondaryButton>
                <SecondaryButton className="sm" onClick={() => navigate("docs")}>
                  Dokumentation
                </SecondaryButton>
              </div>
            </div>
            {recent.length === 0 ? (
              <p className="muted">Noch nichts bearbeitet. Mit „Schnellnotiz“ legst du die erste Notiz an.</p>
            ) : (
              <ul className="recent-list">
                {recent.map((r) => (
                  <li key={r.key}>
                    <button type="button" className="recent-item" onClick={r.open}>
                      <span className="recent-icon">{r.kind === "doc" ? <BookOpen size={16} /> : <FileText size={16} />}</span>
                      <div className="recent-main">
                        <span className="recent-title">{r.title}</span>
                        <span className="recent-preview">{r.preview}</span>
                      </div>
                      <span className="recent-kind">{r.kind === "doc" ? "Dokumentation" : "Notiz"}</span>
                      {r.tag && <span className="tag">{r.tag}</span>}
                      <span className="recent-time">{formatNoteTime(r.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
