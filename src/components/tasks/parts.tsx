import { CalendarDays } from "lucide-react";
import { setTaskDone } from "../../lib/api/tasks";
import { formatDue, isOverdue, subtaskProgress, type Task } from "../../lib/tasks";

/** Abhak-Kästchen. Klick öffnet nicht die Aufgabe, sondern schaltet nur „erledigt“ um. */
export function TaskCheck({ task }: { task: Task }) {
  return (
    <button
      type="button"
      className={`check check-btn${task.done ? " checked" : ""}`}
      role="checkbox"
      aria-checked={task.done}
      aria-label={task.done ? "Als offen markieren" : "Als erledigt markieren"}
      onClick={(e) => {
        e.stopPropagation();
        void setTaskDone(task.id, !task.done);
      }}
    />
  );
}

export function DueDate({ task }: { task: Task }) {
  if (!task.dueDate) return null;
  return (
    <span className={`task-due${isOverdue(task) ? " urgent" : ""}`}>
      <CalendarDays size={12} />
      {formatDue(task.dueDate)}
    </span>
  );
}

/** Fortschrittsbalken der Zwischenschritte (nichts, wenn die Aufgabe keine hat). */
export function SubtaskProgress({ task }: { task: Task }) {
  const { done, total } = subtaskProgress(task);
  if (total === 0) return null;
  return (
    <div className="subtask-progress" title={`${done} von ${total} Zwischenschritten erledigt`}>
      <div className="subtask-track">
        <div className="subtask-fill" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <span>
        {done}/{total}
      </span>
    </div>
  );
}
