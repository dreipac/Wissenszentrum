import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { setSubtaskDone } from "../../lib/api/tasks";
import { MOVE_DELAY_MS, toggleTask, useDoneState } from "../../lib/taskAnimation";
import { formatDue, isOverdue, subtaskProgress, type Task } from "../../lib/tasks";

/**
 * Abhak-Kästchen. Klick öffnet nicht die Aufgabe, sondern schaltet nur „erledigt“ um. Der Haken erscheint mit einer
 * kleinen Bewegung. Wandert die Aufgabe danach weiter (`moves`), wartet das Speichern, bis der Abschluss zu sehen war.
 */
export function TaskCheck({ task, moves = false }: { task: Task; moves?: boolean }) {
  const done = useDoneState(task);
  const [pop, setPop] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      className={`check check-btn${done ? " checked" : ""}${pop ? " pop" : ""}`}
      role="checkbox"
      aria-checked={done}
      aria-label={done ? "Als offen markieren" : "Als erledigt markieren"}
      onClick={(e) => {
        e.stopPropagation();
        if (!done) {
          setPop(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setPop(false), 520);
        }
        toggleTask(task, moves ? MOVE_DELAY_MS : 0);
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

/** Balken mit einem Segment je Zwischenschritt; die ersten `done` Segmente sind gefüllt. */
export function SegmentBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="segment-bar" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? "on" : ""} />
      ))}
    </div>
  );
}

/** Fortschritt der Zwischenschritte als segmentierter Balken mit Zähler (nichts, wenn die Aufgabe keine hat). */
export function SubtaskProgress({ task }: { task: Task }) {
  const { done, total } = subtaskProgress(task);
  if (total === 0) return null;
  return (
    <div className="subtask-progress" title={`${done} von ${total} Zwischenschritten erledigt`}>
      <SegmentBar done={done} total={total} />
      <span>
        {done}/{total}
      </span>
    </div>
  );
}

/** Zwischenschritte als Liste auf der Karte (nur wenn die Aufgabe das so eingestellt hat). Abhaken ist direkt möglich. */
export function CardSubtasks({ task }: { task: Task }) {
  if (!task.showSubtasks || task.subtasks.length === 0) return null;
  return (
    <ul className="card-steps">
      {task.subtasks.map((step) => (
        <li key={step.id} className={step.done ? "done" : ""}>
          <button
            type="button"
            className={`check check-btn sm${step.done ? " checked" : ""}`}
            role="checkbox"
            aria-checked={step.done}
            aria-label={`Zwischenschritt „${step.title}“ ${step.done ? "als offen markieren" : "abhaken"}`}
            onClick={(e) => {
              e.stopPropagation();
              void setSubtaskDone(step.id, !step.done);
            }}
          />
          <span className="strike">{step.title}</span>
        </li>
      ))}
    </ul>
  );
}
