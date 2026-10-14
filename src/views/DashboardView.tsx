import { CalendarClock, ClipboardList, FileText, Flame, NotebookText, Plus } from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { notes } from "../data/mock";
import { formatTimeRange } from "../lib/calendar";
import { addDays, formatDayMonth, formatLongDay, parseDateTime, startOfDay, toDateTimeStr } from "../lib/dates";
import { useDialogs } from "../lib/dialogs";
import { daysUntil, formatDue, isOverdue } from "../lib/tasks";
import { useEvents } from "../lib/useEvents";
import { useTasks } from "../lib/useTasks";
import "./DashboardView.css";

export function DashboardView() {
  const { tasks, buckets } = useTasks();
  const { openNewTask } = useDialogs();
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

  // Fortschritt je Bucket (lose Aufgaben als eigene Zeile)
  const progress = [
    ...buckets.map((b) => ({ id: b.id as number | null, name: b.name, items: tasks.filter((t) => t.bucketId === b.id) })),
    { id: null, name: "Ohne Bucket", items: tasks.filter((t) => t.bucketId === null) },
  ].filter((row) => row.id !== null || row.items.length > 0);

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
    { label: "Notizen", value: "24", hint: "3 neu diese Woche", icon: NotebookText },
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Guten Morgen, Armin</h1>
            <p className="page-subtitle">
              {formatLongDay(new Date())} · {dueToday.length} {dueToday.length === 1 ? "Aufgabe" : "Aufgaben"} heute fällig
            </p>
          </div>
          <div className="page-actions">
            <SecondaryButton>
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
          <section className="card dash-card wide">
            <div className="dash-card-head">
              <h2>Fokus für heute</h2>
              <SecondaryButton className="sm">Alle Aufgaben</SecondaryButton>
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

          <section className="card dash-card">
            <div className="dash-card-head">
              <h2>Fortschritt nach Bucket</h2>
            </div>
            {progress.length === 0 ? (
              <p className="muted">Noch keine Buckets angelegt.</p>
            ) : (
              <ul className="progress-list">
                {progress.map((row) => {
                  const done = row.items.filter((t) => t.done).length;
                  const pct = row.items.length ? (done / row.items.length) * 100 : 0;
                  return (
                    <li key={row.id ?? "none"} className="progress-item">
                      <div className="progress-top">
                        <span>{row.name}</span>
                        <span className="muted">
                          {done}/{row.items.length} erledigt
                        </span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card dash-card wide">
            <div className="dash-card-head">
              <h2>Zuletzt bearbeitet</h2>
              <SecondaryButton className="sm">Alle Notizen</SecondaryButton>
            </div>
            <ul className="recent-list">
              {notes.slice(0, 4).map((n) => (
                <li key={n.id} className="recent-item">
                  <span className="recent-icon">
                    <FileText size={16} />
                  </span>
                  <div className="recent-main">
                    <span className="recent-title">{n.title}</span>
                    <span className="recent-preview">{n.preview}</span>
                  </div>
                  <span className="tag">{n.folder}</span>
                  <span className="recent-time">{n.updated}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
