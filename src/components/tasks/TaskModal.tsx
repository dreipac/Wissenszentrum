import { useEffect, useRef, useState } from "react";
import { SegmentBar } from "./parts";
import { AlignLeft, CalendarDays, FolderKanban, ListChecks, Plus, X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { createTask, deleteTask, updateTask } from "../../lib/api/tasks";
import { listEvents } from "../../lib/api/events";
import { DatePicker } from "../ui/DatePicker";
import { EventOffset } from "./EventOffset";
import { Select } from "../ui/Select";
import type { CalendarEvent } from "../../lib/calendar";
import { addDays, formatDayMonth, formatLongDay, parseDateTime, startOfDay, toDateTimeStr } from "../../lib/dates";
import { dateInDays, eventTaskDate, priorities, priorityLabel, type Priority, type Task } from "../../lib/tasks";
import { useTasks } from "../../lib/useTasks";
import "./TaskModal.css";

interface TaskModalProps {
  /** Ohne Angabe wird eine neue Aufgabe angelegt, sonst diese bearbeitet. */
  task?: Task;
  /** Vorausgewählter Bucket (z. B. beim Klick auf „+“ in einer Spalte). */
  bucketId?: number | null;
  /** Vorbelegung für eine neue Aufgabe (z. B. aus einem Vorschlag des Assistenten). */
  draft?: { title: string; bucketId: number | null; priority: Priority; dueDate: string | null; description: string; subtasks: string[] };
  /** Wird nach erfolgreichem Speichern aufgerufen, vor dem Schließen. */
  onSaved?: () => void;
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

export function TaskModal({ task, bucketId = null, draft, onSaved, onClose }: TaskModalProps) {
  const editing = task !== undefined;
  const { buckets } = useTasks();

  const [title, setTitle] = useState(task?.title ?? draft?.title ?? "");
  const [bucket, setBucket] = useState<number | null>(task?.bucketId ?? draft?.bucketId ?? bucketId);
  const [priority, setPriority] = useState<Priority>(task?.priority ?? draft?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? draft?.dueDate ?? "");
  const [startDate, setStartDate] = useState(task?.startDate ?? "");
  const [description, setDescription] = useState(task?.description ?? draft?.description ?? "");
  const nextKey = useRef(0);
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    task
      ? task.subtasks.map((s) => ({ key: nextKey.current++, id: s.id, title: s.title, done: s.done }))
      : (draft?.subtasks ?? []).map((title) => ({ key: nextKey.current++, id: null, title, done: false })),
  );
  const [newStep, setNewStep] = useState("");
  const [showSubtasks, setShowSubtasks] = useState(task?.showSubtasks ?? false);
  const [showDescription, setShowDescription] = useState(task?.showDescription ?? false);
  const [eventId, setEventId] = useState<number | null>(task?.eventId ?? null);
  const [eventOffset, setEventOffset] = useState(task?.eventOffset ?? -1);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  // Fälligkeit entweder als festes Datum oder relativ zu einem Termin
  const [byEvent, setByEvent] = useState(task?.eventId != null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Termine zur Auswahl: die letzten zwei Wochen und das kommende Jahr
  useEffect(() => {
    const today = startOfDay(new Date());
    listEvents(toDateTimeStr(addDays(today, -14)), toDateTimeStr(addDays(today, 400)))
      .then(setEvents)
      .catch(() => setEvents([]));
  }, []);

  // Der gewählte Termin; liegt er außerhalb der Auswahl (alter Termin), genügen die Angaben, die die Aufgabe selbst trägt
  type EventRef = Pick<CalendarEvent, "id" | "title" | "startsAt" | "endsAt">;
  const ownEvent: EventRef | null =
    task?.eventId != null && task.eventTitle && task.eventStartsAt && task.eventEndsAt
      ? { id: task.eventId, title: task.eventTitle, startsAt: task.eventStartsAt, endsAt: task.eventEndsAt }
      : null;
  const linked: EventRef | null =
    eventId === null ? null : (events.find((e) => e.id === eventId) ?? (ownEvent?.id === eventId ? ownEvent : null));
  const derivedDue = linked ? eventTaskDate(linked.startsAt, linked.endsAt, eventOffset) : null;
  const eventChoices: EventRef[] = ownEvent && !events.some((e) => e.id === ownEvent.id) ? [ownEvent, ...events] : events;

  const chooseMode = (toEvent: boolean) => {
    if (toEvent === byEvent) return;
    if (!toEvent) {
      // Gelöst bleibt das bisherige Datum stehen
      if (derivedDue) setDueDate(derivedDue);
      setEventId(null);
    }
    setByEvent(toEvent);
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onSaved?.();
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
    if (byEvent && eventId === null) return setError("Bitte wähle einen Termin oder ein festes Datum.");
    if (eventId !== null && !linked) return setError("Der gewählte Termin wird noch geladen.");
    const due = derivedDue ?? (dueDate || startDate || null);
    // Verschiebt sich die Fälligkeit mit dem Termin vor den Beginn, zieht der Beginn mit
    const start = startDate && due && startDate > due ? due : startDate || null;
    const input = {
      title: title.trim(),
      bucketId: bucket,
      priority,
      startDate: start,
      dueDate: due,
      description,
      showSubtasks,
      showDescription,
      eventId,
      eventOffset: eventId === null ? null : eventOffset,
      subtasks,
    };
    void run(() => (editing ? updateTask(task.id, input) : createTask(input)));
  };

  return (
    <Modal
      title={editing ? "Aufgabe bearbeiten" : "Neue Aufgabe"}
      width={640}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <SecondaryButton className="danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Löschen
            </SecondaryButton>
          )}
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
        <div className="tm-row-body tm-pair">
          <Select<number | null>
            className="tm-bucket"
            ariaLabel="Bucket"
            value={bucket}
            onChange={setBucket}
            options={[{ value: null, label: "Kein Bucket" }, ...buckets.map((b) => ({ value: b.id, label: b.name }))]}
          />
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
        <div className="tm-row-body tm-stack">
          <div className="segmented tm-mode" role="radiogroup" aria-label="Fälligkeit festlegen">
            <button type="button" role="radio" aria-checked={!byEvent} className={!byEvent ? "active" : ""} onClick={() => chooseMode(false)}>
              Festes Datum
            </button>
            <button type="button" role="radio" aria-checked={byEvent} className={byEvent ? "active" : ""} onClick={() => chooseMode(true)}>
              Am Termin
            </button>
          </div>

          {byEvent ? (
            <>
              <div className="tm-due">
                <Select<number | null>
                  className="tm-event"
                  ariaLabel="Termin"
                  placeholder="Termin wählen …"
                  value={eventId}
                  onChange={setEventId}
                  options={eventChoices.map((e) => ({ value: e.id, label: e.title, hint: formatDayMonth(parseDateTime(e.startsAt)) }))}
                />
                {eventId !== null && <EventOffset value={eventOffset} onChange={setEventOffset} />}
              </div>
              {derivedDue ? (
                <div className="tm-due">
                  <span className="tm-derived">{formatLongDay(parseDateTime(`${derivedDue} 00:00`))}</span>
                </div>
              ) : (
                eventChoices.length === 0 && <span className="tm-hint">Im Kalender gibt es noch keinen Termin.</span>
              )}
            </>
          ) : (
            <div className="tm-due">
              <DatePicker
                className="dp-inline"
                ariaLabel="Fällig am"
                value={dueDate}
                onChange={(v) => {
                  setDueDate(v);
                  // Das Ende darf nicht vor dem Beginn liegen
                  if (startDate && v && v < startDate) setStartDate(v);
                  if (!v) setStartDate("");
                }}
              />
              {QUICK_DATES.map(({ label, days }) => (
                <button key={label} type="button" className="tm-quick" onClick={() => setDueDate(dateInDays(days))}>
                  {label}
                </button>
              ))}
              {dueDate && (
                <button
                  type="button"
                  className="tm-quick"
                  onClick={() => {
                    setDueDate("");
                    setStartDate("");
                  }}
                >
                  Entfernen
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="tm-row top">
        <ListChecks size={18} className="tm-icon" />
        <div className="tm-row-body">
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
          <div className="tm-steps-head tm-steps-foot">
            {steps.length > 0 && (
              <>
                <SegmentBar done={steps.filter((s) => s.done).length} total={steps.length} />
                <span>
                  {steps.filter((s) => s.done).length}/{steps.length}
                </span>
              </>
            )}
            {/* Der Schalter erscheint, sobald es etwas anzuzeigen gibt; sein Platz bleibt frei, damit nichts springt */}
            <label className={`checkbox-row tm-steps-toggle${steps.length === 0 ? " idle" : ""}`}>
              <input type="checkbox" checked={showSubtasks} onChange={(e) => setShowSubtasks(e.target.checked)} />
              <span className={`check sm${showSubtasks ? " checked" : ""}`} />
              Auf der Karte anzeigen
            </label>
          </div>
        </div>
      </div>

      <div className="tm-row top">
        <AlignLeft size={18} className="tm-icon" />
        <div className="tm-row-body">
          <div className="tm-steps-head tm-notes-head">
            <span>Notiz</span>
            <label className={`checkbox-row tm-steps-toggle${description.trim() ? "" : " idle"}`}>
              <input type="checkbox" checked={showDescription} onChange={(e) => setShowDescription(e.target.checked)} />
              <span className={`check sm${showDescription ? " checked" : ""}`} />
              Auf der Karte anzeigen
            </label>
          </div>
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

      {confirmDelete && editing && (
        <ConfirmDialog
          title="Aufgabe löschen?"
          message={`„${task.title}“ wird dauerhaft gelöscht, samt Zwischenschritten.`}
          busy={busy}
          onConfirm={() => void run(() => deleteTask(task.id))}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
