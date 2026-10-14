import { useRef, useState } from "react";
import { AlignLeft, CalendarDays, Flag, FolderKanban, ListChecks, Plus, X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { createTask, deleteTask, updateTask } from "../../lib/api/tasks";
import { dateInDays, priorities, priorityLabel, type Priority, type Task } from "../../lib/tasks";
import { useTasks } from "../../lib/useTasks";
import "./TaskModal.css";

interface TaskModalProps {
  /** Ohne Angabe wird eine neue Aufgabe angelegt, sonst diese bearbeitet. */
  task?: Task;
  /** Vorausgewählter Bucket (z. B. beim Klick auf „+“ in einer Spalte). */
  bucketId?: number | null;
  onClose: () => void;
}

const QUICK_DATES = [
  { label: "Heute", days: 0 },
  { label: "Morgen", days: 1 },
  { label: "In einer Woche", days: 7 },
];

/** Zwischenschritt im Entwurf; `key` bleibt stabil, auch wenn Einträge davor gelöscht werden. */
interface StepDraft {
  key: number;
  id: number | null;
  title: string;
  done: boolean;
}

export function TaskModal({ task, bucketId = null, onClose }: TaskModalProps) {
  const editing = task !== undefined;
  const { buckets } = useTasks();

  const [title, setTitle] = useState(task?.title ?? "");
  const [bucket, setBucket] = useState<number | null>(task?.bucketId ?? bucketId);
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const nextKey = useRef(0);
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    (task?.subtasks ?? []).map((s) => ({ key: nextKey.current++, id: s.id, title: s.title, done: s.done })),
  );
  const [newStep, setNewStep] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const patchStep = (key: number, patch: Partial<StepDraft>) =>
    setSteps((list) => list.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const addStep = () => {
    const text = newStep.trim();
    if (!text) return;
    setSteps((list) => [...list, { key: nextKey.current++, id: null, title: text, done: false }]);
    setNewStep("");
  };

  const save = () => {
    if (!title.trim()) return setError("Bitte gib einen Titel ein.");
    // Ein noch nicht mit Enter bestätigter Zwischenschritt geht nicht verloren
    const pending = newStep.trim() ? [{ id: null, title: newStep.trim(), done: false }] : [];
    const subtasks = [
      ...steps.filter((s) => s.title.trim()).map((s) => ({ id: s.id, title: s.title.trim(), done: s.done })),
      ...pending,
    ];
    const input = { title: title.trim(), bucketId: bucket, priority, dueDate: dueDate || null, description, subtasks };
    void run(() => (editing ? updateTask(task.id, input) : createTask(input)));
  };

  return (
    <Modal
      title={editing ? "Aufgabe bearbeiten" : "Neue Aufgabe"}
      width={640}
      onClose={onClose}
      footer={
        <>
          {editing &&
            (confirmDelete ? (
              <SecondaryButton className="danger" disabled={busy} onClick={() => void run(() => deleteTask(task.id))}>
                Wirklich löschen?
              </SecondaryButton>
            ) : (
              <SecondaryButton className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Löschen
              </SecondaryButton>
            ))}
          <span className="spacer" />
          <SecondaryButton onClick={onClose}>Abbrechen</SecondaryButton>
          <Button disabled={busy} onClick={save}>
            {editing ? "Speichern" : "Aufgabe erstellen"}
          </Button>
        </>
      }
    >
      <input
        className="tm-title"
        value={title}
        autoFocus
        placeholder="Was ist zu tun?"
        aria-label="Titel"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />

      <div className="tm-row">
        <FolderKanban size={18} className="tm-icon" />
        <div className="tm-row-body">
          <select
            className="field-control"
            aria-label="Bucket"
            value={bucket ?? ""}
            onChange={(e) => setBucket(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="">Kein Bucket</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tm-row">
        <Flag size={18} className="tm-icon" />
        <div className="tm-row-body">
          <div className="segmented tm-priority" role="radiogroup" aria-label="Priorität">
            {priorities.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={priority === p}
                className={priority === p ? "active" : ""}
                onClick={() => setPriority(p)}
              >
                <span className={`priority ${p}`} />
                {priorityLabel[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="tm-row">
        <CalendarDays size={18} className="tm-icon" />
        <div className="tm-row-body">
          <div className="tm-due">
            <input
              type="date"
              className="field-control"
              aria-label="Fällig am"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            {QUICK_DATES.map(({ label, days }) => (
              <button key={label} type="button" className="tm-quick" onClick={() => setDueDate(dateInDays(days))}>
                {label}
              </button>
            ))}
            {dueDate && (
              <button type="button" className="tm-quick" onClick={() => setDueDate("")}>
                Entfernen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="tm-row top">
        <ListChecks size={18} className="tm-icon" />
        <div className="tm-row-body">
          {steps.length > 0 && (
            <div className="tm-steps-head">
              <div className="subtask-track">
                <div
                  className="subtask-fill"
                  style={{ width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%` }}
                />
              </div>
              <span>
                {steps.filter((s) => s.done).length}/{steps.length}
              </span>
            </div>
          )}
          <ul className="tm-steps">
            {steps.map((step) => (
              <li key={step.key} className={`tm-step${step.done ? " done" : ""}`}>
                <button
                  type="button"
                  className={`check check-btn${step.done ? " checked" : ""}`}
                  role="checkbox"
                  aria-checked={step.done}
                  aria-label="Zwischenschritt abhaken"
                  onClick={() => patchStep(step.key, { done: !step.done })}
                />
                <input
                  className="tm-step-input"
                  value={step.title}
                  aria-label="Zwischenschritt"
                  onChange={(e) => patchStep(step.key, { title: e.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn tm-step-remove"
                  aria-label="Zwischenschritt entfernen"
                  onClick={() => setSteps((list) => list.filter((s) => s.key !== step.key))}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <div className="tm-step-add">
            <Plus size={15} />
            <input
              value={newStep}
              placeholder="Zwischenschritt hinzufügen und Enter drücken"
              aria-label="Neuer Zwischenschritt"
              onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addStep();
                }
              }}
            />
          </div>
        </div>
      </div>

      <div className="tm-row top">
        <AlignLeft size={18} className="tm-icon" />
        <div className="tm-row-body">
          <textarea
            className="field-control tm-description"
            aria-label="Beschreibung"
            value={description}
            placeholder="Beschreibung hinzufügen"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="field-error">{error}</p>}
    </Modal>
  );
}
