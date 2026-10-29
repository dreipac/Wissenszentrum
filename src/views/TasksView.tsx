import { useMemo, useState } from "react";
import { CalendarCheck, CalendarRange, CheckSquare, KanbanSquare, List, Plus, Search } from "lucide-react";
import { Button } from "../components/ui/Button";
import { SecondaryButton } from "../components/ui/SecondaryButton";
import { Board, type Column } from "../components/tasks/Board";
import { TaskCheck } from "../components/tasks/parts";
import { Timeline } from "../components/tasks/Timeline";
import { TodayView } from "../components/tasks/TodayView";
import { useDialogs } from "../lib/dialogs";
import { useDoneState } from "../lib/taskAnimation";
import { formatDue, isOverdue, priorityLabel, type Bucket, type Task } from "../lib/tasks";
import { useTasks } from "../lib/useTasks";
import "./TasksView.css";

type TaskTab = "today" | "board" | "list" | "timeline";
type StatusFilter = "all" | "open" | "done";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "open", label: "Offen" },
  { id: "done", label: "Erledigt" },
];

function ListRow({ task, bucket, moves, onOpen }: { task: Task; bucket: string; moves: boolean; onOpen: () => void }) {
  const done = useDoneState(task);
  return (
    <div className={`task-row${done ? " done" : ""}`} onClick={onOpen}>
      <TaskCheck task={task} moves={moves} />
      <span className="task-row-title">
        <span className="strike">{task.title}</span>
      </span>
      <span className="muted">{bucket}</span>
      <span className="task-row-priority">
        <span className={`priority ${task.priority}`} />
        {priorityLabel[task.priority]}
      </span>
      <span className={isOverdue(task) ? "task-due urgent" : "muted"}>{task.dueDate ? formatDue(task.dueDate) : "—"}</span>
    </div>
  );
}

function ListView({ tasks, buckets }: { tasks: Task[]; buckets: Bucket[] }) {
  const { openEditTask } = useDialogs();
  const bucketName = (id: number | null) => buckets.find((b) => b.id === id)?.name ?? "—";

  if (tasks.length === 0) return <p className="list-empty muted">Keine Aufgaben gefunden.</p>;

  return (
    <div className="task-table card">
      <div className="task-row head">
        <span />
        <span>Aufgabe</span>
        <span>Bucket</span>
        <span>Priorität</span>
        <span>Fällig</span>
      </div>
      {tasks.map((task) => (
        <ListRow key={task.id} task={task} bucket={bucketName(task.bucketId)} moves={buckets.find((b) => b.id === task.bucketId)?.onCompleteBucketId != null} onOpen={() => openEditTask(task)} />
      ))}
    </div>
  );
}

function EmptyState() {
  const { openNewTask, openNewBucket } = useDialogs();
  return (
    <div className="tasks-empty card">
      <CheckSquare size={30} />
      <h3>Noch keine Aufgaben</h3>
      <p>Lege deine erste Aufgabe an. Mit Buckets kannst du Aufgaben später gruppieren, zum Beispiel nach Projekt oder Status.</p>
      <div className="tasks-empty-actions">
        <SecondaryButton onClick={openNewBucket}>
          <Plus size={16} />
          Neuer Bucket
        </SecondaryButton>
        <Button onClick={() => openNewTask()}>
          <Plus size={16} />
          Neue Aufgabe
        </Button>
      </div>
    </div>
  );
}

export function TasksView() {
  const { tasks, buckets, loaded, error } = useTasks();
  const { openNewTask, openNewBucket, openBucketMenu, openBoardMenu } = useDialogs();
  const [tab, setTab] = useState<TaskTab>("today");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        (status === "all" || (status === "done") === t.done) &&
        (!q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)),
    );
  }, [tasks, query, status]);

  // Spalte „Ohne Bucket“ nur zeigen, wenn sie gebraucht wird: es gibt lose Aufgaben oder noch gar keine Buckets
  const columns: Column[] = useMemo(() => {
    const unassigned = tasks.some((t) => t.bucketId === null);
    const list: Column[] = buckets.map((b) => ({
      bucket: b,
      name: b.name,
      tasks: filtered.filter((t) => t.bucketId === b.id),
    }));
    if (unassigned || buckets.length === 0) {
      list.unshift({
        bucket: null,
        name: buckets.length === 0 ? "Aufgaben" : "Ohne Bucket",
        tasks: filtered.filter((t) => t.bucketId === null),
      });
    }
    return list;
  }, [tasks, buckets, filtered]);

  const doneCount = tasks.filter((t) => t.done).length;
  const subtitle =
    tasks.length === 0
      ? buckets.length === 0
        ? "Noch nichts angelegt"
        : `${buckets.length} ${buckets.length === 1 ? "Bucket" : "Buckets"} · noch keine Aufgaben`
      : `${tasks.length} ${tasks.length === 1 ? "Aufgabe" : "Aufgaben"}${
          buckets.length ? ` in ${buckets.length} ${buckets.length === 1 ? "Bucket" : "Buckets"}` : ""
        } · ${doneCount} erledigt`;

  // Rechtsklick im Board: auf einem Bucket sein Menü, auf Aufgaben nichts Eigenes, auf freier Fläche „Neuer Bucket“
  const onBoardMenu = (e: React.MouseEvent) => {
    if (tab !== "board") return;
    e.preventDefault();
    const target = e.target as Element;
    if (target.closest(".task-card")) return;
    const column = target.closest<HTMLElement>("[data-bucket-id]");
    const bucket = column ? buckets.find((b) => String(b.id) === column.dataset.bucketId) : undefined;
    if (bucket) openBucketMenu(bucket, e.clientX, e.clientY);
    else openBoardMenu(e.clientX, e.clientY);
  };

  const empty = loaded && tasks.length === 0 && buckets.length === 0;
  const showToolbar = (tab === "board" || tab === "list") && !empty;

  const tabs: { id: TaskTab; label: string; icon: typeof List }[] = [
    { id: "today", label: "Heute", icon: CalendarCheck },
    { id: "board", label: "Board", icon: KanbanSquare },
    { id: "list", label: "Liste", icon: List },
    { id: "timeline", label: "Zeitplan", icon: CalendarRange },
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Aufgaben</h1>
            <p className="page-subtitle">{loaded ? subtitle : " "}</p>
          </div>
          <div className="page-actions">
            <SecondaryButton onClick={openNewBucket}>
              <Plus size={16} />
              Neuer Bucket
            </SecondaryButton>
            <Button onClick={() => openNewTask()}>
              <Plus size={16} />
              Neue Aufgabe
            </Button>
          </div>
        </div>

        <div className="tabs">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      </header>

      {showToolbar && (
        <div className="toolbar">
          <label className="input toolbar-search">
            <Search size={14} />
            <input placeholder="Aufgaben durchsuchen …" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="toolbar-spacer" />
          <div className="segmented">
            {STATUS_FILTERS.map((f) => (
              <button key={f.id} type="button" className={status === f.id ? "active" : ""} onClick={() => setStatus(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`page-body tasks-body${tab === "today" ? " depth" : ""}`} onContextMenu={onBoardMenu}>
        {error && <p className="field-error">Aufgaben konnten nicht geladen werden: {error}</p>}
        {tab === "today" && <TodayView />}
        {loaded && empty && (tab === "board" || tab === "list") && <EmptyState />}
        {loaded && !empty && tab === "board" && <Board columns={columns} />}
        {loaded && !empty && tab === "list" && <ListView tasks={filtered} buckets={buckets} />}
        {loaded && tab === "timeline" && <Timeline />}
      </div>
    </div>
  );
}
