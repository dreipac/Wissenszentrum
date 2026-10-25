import { useEffect, useRef, useState } from "react";
import { AlignLeft, ArrowRight, Clock, MapPin } from "lucide-react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { SecondaryButton } from "../ui/SecondaryButton";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DatePicker } from "../ui/DatePicker";
import type { EventDraft } from "../../lib/calendar";
import { createEvent, deleteEvent, updateEvent } from "../../lib/api/events";
import { createTask, setTaskDone, updateTask } from "../../lib/api/tasks";
import { taskToInput } from "../../lib/tasks";
import { useTasks } from "../../lib/useTasks";
import { EventTasks, type EventTaskAdder, type EventTaskDraft } from "./EventTasks";
import "./EventModal.css";

interface EventModalProps {
  draft: EventDraft;
  onClose: () => void;
  /** Wird nach Speichern oder Löschen aufgerufen, damit die Ansicht neu lädt. */
  onChanged: () => void;
}

export function EventModal({ draft, onClose, onChanged }: EventModalProps) {
  const editing = draft.id !== undefined;

  const [title, setTitle] = useState(draft.title ?? "");
  const [allDay, setAllDay] = useState(draft.allDay ?? false);
  const [startDate, setStartDate] = useState(draft.startsAt.slice(0, 10));
  const [startTime, setStartTime] = useState(draft.startsAt.slice(11) || "09:00");
  const [endDate, setEndDate] = useState(draft.endsAt.slice(0, 10));
  const [endTime, setEndTime] = useState(draft.endsAt.slice(11) || "10:00");
  const [location, setLocation] = useState(draft.location ?? "");
  const [description, setDescription] = useState(draft.description ?? "");

  // Aufgaben am Termin: bestehende laden, sobald die Aufgaben da sind; neue und Änderungen gelten erst beim Speichern
  const { tasks, loaded } = useTasks();
  const nextKey = useRef(0);
  const [items, setItems] = useState<EventTaskDraft[]>([]);
  const [adder, setAdder] = useState<EventTaskAdder>({ title: "", offset: -1 });
  const itemsReady = useRef(!editing);
  useEffect(() => {
    if (itemsReady.current || !loaded) return;
    itemsReady.current = true;
    setItems(
      tasks
        .filter((t) => t.eventId === draft.id && t.eventOffset !== null)
        .sort((a, b) => a.eventOffset! - b.eventOffset! || a.id - b.id)
        .map((task) => ({ key: nextKey.current++, task, title: task.title, offset: task.eventOffset!, done: task.done })),
    );
  }, [loaded, tasks, draft.id]);

  const addItem = () => {
    const text = adder.title.trim();
    if (!text) return;
    setItems((list) => [...list, { key: nextKey.current++, task: null, title: text, offset: adder.offset, done: false }]);
    setAdder({ ...adder, title: "" });
  };

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startsAt = `${startDate} ${allDay ? "00:00" : startTime}`;
  const endsAt = `${endDate} ${allDay ? "23:59" : endTime}`;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const save = () => {
    if (!title.trim()) return setError("Bitte gib einen Titel ein.");
    if (!startDate || !endDate) return setError("Bitte Datum angeben.");
    if (endsAt <= startsAt) return setError("Das Ende muss nach dem Beginn liegen.");
    if (editing && !itemsReady.current) return setError("Die Aufgaben werden noch geladen.");
    const input = { title: title.trim(), description, location, startsAt, endsAt, allDay };
    // Eine noch nicht mit Enter bestätigte Aufgabe geht nicht verloren
    const pending: EventTaskDraft[] = adder.title.trim()
      ? [{ key: -1, task: null, title: adder.title.trim(), offset: adder.offset, done: false }]
      : [];
    const all = [...items, ...pending].filter((i) => i.title.trim());
    void run(async () => {
      // Gelöste Aufgaben zuerst: sie behalten ihr Datum, auch wenn der Termin gleich verschoben wird
      const kept = new Set(all.map((i) => i.task?.id));
      for (const t of tasks.filter((x) => x.eventId === draft.id && !kept.has(x.id))) {
        await updateTask(t.id, taskToInput(t, { eventId: null, eventOffset: null }));
      }
      const event = editing ? await updateEvent(draft.id!, input) : await createEvent(input);
      for (const item of all) {
        if (!item.task) {
          const created = await createTask({
            title: item.title.trim(),
            bucketId: null,
            priority: "medium",
            description: "",
            dueDate: null,
            startDate: null,
            showSubtasks: false,
            showDescription: false,
            eventId: event.id,
            eventOffset: item.offset,
            subtasks: [],
          });
          if (item.done) await setTaskDone(created.id, true);
          continue;
        }
        if (item.task.title !== item.title.trim() || item.task.eventOffset !== item.offset) {
          await updateTask(item.task.id, taskToInput(item.task, { title: item.title.trim(), eventId: event.id, eventOffset: item.offset }));
        }
        if (item.task.done !== item.done) await setTaskDone(item.task.id, item.done);
      }
    });
  };

  const onStartDate = (value: string) => {
    setStartDate(value);
    if (value && endDate < value) setEndDate(value);
  };

  return (
    <Modal
      title={editing ? "Termin bearbeiten" : "Neuer Termin"}
      width={760}
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
            Speichern
          </Button>
        </>
      }
    >
      <input
        className="ev-title"
        value={title}
        autoFocus
        placeholder="Titel hinzufügen"
        aria-label="Titel"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />

      <div className="ev-row">
        <Clock size={18} className="ev-icon" />
        <div className="ev-row-body">
          <div className="ev-datetime">
            <DatePicker className="dp-inline" ariaLabel="Beginn Datum" value={startDate} onChange={onStartDate} />
            {!allDay && (
              <input type="time" className="field-control" aria-label="Beginn Uhrzeit" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            )}
            <ArrowRight size={16} className="ev-arrow" />
            {!allDay && (
              <input type="time" className="field-control" aria-label="Ende Uhrzeit" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            )}
            <DatePicker className="dp-inline" ariaLabel="Ende Datum" value={endDate} min={startDate} onChange={setEndDate} />
          </div>
          <label className="checkbox-row">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
            <span className={`check${allDay ? " checked" : ""}`} />
            Ganztägig
          </label>
        </div>
      </div>

      <div className="ev-row">
        <MapPin size={18} className="ev-icon" />
        <div className="ev-row-body">
          <input className="field-control" aria-label="Ort" value={location} placeholder="Ort hinzufügen" onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      <div className="ev-row top">
        <AlignLeft size={18} className="ev-icon" />
        <div className="ev-row-body">
          <textarea className="field-control ev-description" aria-label="Beschreibung" value={description} placeholder="Beschreibung hinzufügen" onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <EventTasks
        items={items}
        onItems={setItems}
        adder={adder}
        onAdder={setAdder}
        startDate={startDate}
        endDate={endDate}
        onAdd={addItem}
      />

      {error && <p className="field-error">{error}</p>}

      {confirmDelete && (
        <ConfirmDialog
          title="Termin löschen?"
          message={`„${title.trim() || "Ohne Titel"}“ wird dauerhaft gelöscht.`}
          busy={busy}
          onConfirm={() => void run(() => deleteEvent(draft.id!))}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </Modal>
  );
}
