import { CalendarClock, ClipboardList, FileText, Flame, Plus } from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { formatTimeRange } from "../lib/calendar";
import { addDays, formatDayMonth, formatLongDay, parseDateTime, startOfDay, toDateTimeStr } from "../lib/dates";
import { useDialogs } from "../lib/dialogs";
import { useNavigate } from "../lib/navigation";
import { useProfile } from "../lib/profile";
import { formatNoteTime, isEmptyNote, noteTitle, notePreview } from "../lib/notes";
import { createAndOpenNote } from "../lib/notesActions";
import { requestOpenNote } from "../lib/notesNav";
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

export function DashboardView() {
  const profile = useProfile();
  const { tasks } = useTasks();
  const { notes } = useNotes();
  const { openNewTask } = useDialogs();
  const navigate = useNavigate();
  // Zuletzt bearbeitete Notizen (unabhängig vom Anpinnen)
  const recentNotes = notes.filter((n) => !isEmptyNote(n)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id).slice(0, 4);
  // Anstehende Termine der nächsten 7 Tage aus der Datenbank
  const today = startOfDay(new Date());
  const { events } = useEvents(toDateTimeStr(today), toDateTimeStr(addDays(today, 7)));
  const nowStr = toDateTimeStr(new Date());
  const upcoming = events.filter((e) => e.endsAt > nowStr);
  const next = upcoming[0];

  // Aufgaben: offene, heute fällige und überfällige
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => isOverdue(t));
  const dueToday = open.filter((t) => t.dueDate !== null && daysUntil(t.dueDate) === 0);
  const focus = [...overdue, ...dueToday];
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
              <h2>Fokus für heute</h2>
              <SecondaryButton className="sm" onClick={() => navigate("tasks")}>
                Alle Aufgaben
              </SecondaryButton>
            </div>
            {focus.length === 0 ? (
              <p className="muted">Nichts fällig – für heute ist alles im Plan.</p>
            ) : (
              <ul className="focus-list">
                {focus.map((t) => (
                  <li key={t.id} className="focus-item">
                    <span className={`priority ${t.priority}`} />
                    <div className="focus-main">
                      <span className="focus-title">{t.title}</span>
                    </div>
                    <span className={`due${isOverdue(t) ? " urgent" : ""}`}>{formatDue(t.dueDate!)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card dash-card">
            <div className="dash-card-head">
              <h2>Nächste Termine</h2>
            </div>
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
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card dash-card full">
            <div className="dash-card-head">
              <h2>Zuletzt bearbeitet</h2>
              <SecondaryButton className="sm" onClick={() => navigate("notes")}>
                Alle Notizen
              </SecondaryButton>
            </div>
            {recentNotes.length === 0 ? (
              <p className="muted">Noch keine Notizen. Mit „Schnellnotiz“ legst du die erste an.</p>
            ) : (
              <ul className="recent-list">
                {recentNotes.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="recent-item"
                      onClick={() => {
                        requestOpenNote(n.id);
                        navigate("notes");
                      }}
                    >
                      <span className="recent-icon">
                        <FileText size={16} />
                      </span>
                      <div className="recent-main">
                        <span className="recent-title">{noteTitle(n)}</span>
                        <span className="recent-preview">{notePreview(n, 100) || "Kein weiterer Text"}</span>
                      </div>
                      {n.folder && <span className="tag">{n.folder}</span>}
                      <span className="recent-time">{formatNoteTime(n.updatedAt)}</span>
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
