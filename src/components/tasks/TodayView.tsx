import { useState } from "react";
import { CalendarCheck, Plus } from "lucide-react";
import { createTask } from "../../lib/api/tasks";
import { formatLongDay } from "../../lib/dates";
import { useDialogs } from "../../lib/dialogs";
import { daysUntil, dateInDays, priorityLabel, type Task } from "../../lib/tasks";
import { useTasks } from "../../lib/useTasks";
import { SubtaskProgress, TaskCheck } from "./parts";
import "./TodayView.css";

function TodayRow({ task, bucketName }: { task: Task; bucketName: string | null }) {
  const { openEditTask } = useDialogs();
  return (
    <li
      className={`today-row${task.done ? " done" : ""}`}
      tabIndex={0}
      onClick={() => openEditTask(task)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openEditTask(task)}
    >
      <TaskCheck task={task} />
      <div className="today-row-main">
        <span className="today-row-title">{task.title}</span>
        {task.description && <span className="today-row-desc">{task.description}</span>}
      </div>
      <div className="today-row-side">
        <SubtaskProgress task={task} />
        {bucketName && <span className="tag">{bucketName}</span>}
        <span className="today-row-priority">
          <span className={`priority ${task.priority}`} />
          {priorityLabel[task.priority]}
        </span>
      </div>
    </li>
  );
}

function Section({ title, tasks, muted, bucketName }: { title: string; tasks: Task[]; muted?: boolean; bucketName: (t: Task) => string | null }) {
  if (tasks.length === 0) return null;
  return (
    <section className="today-section">
      <header className={`today-section-head${muted ? " muted" : ""}`}>
        <h2>{title}</h2>
        <span className="today-count">{tasks.length}</span>
      </header>
      <ul className="today-list">
        {tasks.map((t) => (
          <TodayRow key={t.id} task={t} bucketName={bucketName(t)} />
        ))}
      </ul>
    </section>
  );
}

/** Zeigt ausschließlich Aufgaben, die heute fällig sind. */
export function TodayView() {
  const { tasks, buckets, loaded } = useTasks();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  const bucketName = (t: Task) => buckets.find((b) => b.id === t.bucketId)?.name ?? null;
  const isToday = (t: Task) => t.dueDate !== null && daysUntil(t.dueDate) === 0;

  const open = tasks.filter((t) => !t.done && isToday(t));
  const done = tasks.filter((t) => t.done && isToday(t));
  const total = open.length + done.length;
  const pct = total ? (done.length / total) * 100 : 0;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await createTask({
        title: title.trim(),
        bucketId: null,
        priority: "medium",
        dueDate: dateInDays(0),
        description: "",
        subtasks: [],
      });
      setTitle("");
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  };

  if (!loaded) return null;

  return (
    <div className="today">
      <div className="card today-card">
        <div className="today-summary">
          <div>
            <span className="card-title">{formatLongDay(new Date())}</span>
            <div className="today-summary-main">
              {total === 0 ? "Heute ist nichts geplant" : `${done.length} von ${total} erledigt`}
            </div>
          </div>
          {total > 0 && (
            <div className="today-progress" aria-hidden>
              <div className="today-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>

        <Section title="Heute" tasks={open} bucketName={bucketName} />
        <Section title="Erledigt" muted tasks={done} bucketName={bucketName} />

        {total === 0 && (
          <div className="today-empty">
            <CalendarCheck size={28} />
            <p>Für heute ist nichts fällig. Trage unten eine Aufgabe ein oder vergib bei einer Aufgabe das heutige Datum.</p>
          </div>
        )}

        <form className="today-add" onSubmit={(e) => void add(e)}>
          <Plus size={16} />
          <input
            value={title}
            placeholder="Aufgabe für heute hinzufügen und Enter drücken"
            aria-label="Neue Aufgabe für heute"
            onChange={(e) => setTitle(e.target.value)}
          />
        </form>
      </div>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
